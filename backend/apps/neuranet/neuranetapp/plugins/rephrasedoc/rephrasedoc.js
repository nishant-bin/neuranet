/**
 * Rephrases the document and returns the new document.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const textsplitter = require(`${NEURANET_CONSTANTS.LIBDIR}/textsplitter.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const PROMPT_PARAM = "_promptparam";

async function generate(fileindexer, generatorDefinition) {
    let document = await fileindexer.getContents(generatorDefinition.encoding||"utf8"), 
        prompt = generatorDefinition.prompt, 
        modelObject = await aiutils.getAIModel(generatorDefinition.model.name, generatorDefinition.model.model_overrides),
        embeddingsModel = await aiutils.getAIModel(modelObject.embeddings_model);

    if (!document) {LOG.error(`File content extraction failed for ${fileindexer.filepath}.`); return {result: false};}
    document = document.replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ");

    const langDetected = langdetector.getISOLang(document),
        split_separators = embeddingsModel.split_separators[langDetected] || embeddingsModel.split_separators["*"],
        split_joiners = embeddingsModel.split_joiners[langDetected] || embeddingsModel.split_joiners["*"],
        splits = textsplitter.getSplits(document, embeddingsModel.request_chunk_size[langDetected], 
            split_separators, 0);

    const promptData = {}; for (const [key,value] of Object.entries(generatorDefinition)) {
        const keyNormalized = key.toLowerCase().trim();
        if (keyNormalized.endsWith(PROMPT_PARAM)) promptData[aiapp.extractRawKeyName(key)] = value;
    }

    const langArr = splits.map(part => langdetector.getISOLang(part));
    const langSelected = (langArr.includes('zh') && langArr.includes('ja') && generatorDefinition?.defaultlanguage) ?
        generatorDefinition.defaultlanguage : (langArr.includes('zh') ? 'zh' : (langArr.includes('ja') ? 'ja' : langDetected));

    const rephrasedSplits = []; for (const split of splits) {
        promptData.fragment = split;
        promptData.lang = langSelected; 
        const rephrasedSplit = await simplellm.prompt_answer(prompt, fileindexer.id, fileindexer.org, promptData, modelObject);
        if (!rephrasedSplit) continue;
        rephrasedSplits.push(rephrasedSplit);
    }

    return {result: true, contentBufferOrReadStream: _ => Buffer.from(rephrasedSplits.join(split_joiners[0]), 
        generatorDefinition.encoding||"utf8"), lang: langDetected};
}

module.exports = {generate}