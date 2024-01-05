/**
 * Rephrases the document and returns the new document.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const textsplitter = require(`${NEURANET_CONSTANTS.LIBDIR}/textsplitter.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const PROMPT_PARAM = "promptparam(";

async function generate(fileindexer, generatorDefinition) {
    const document = await fileindexer.getContents(generatorDefinition.encoding||"utf8"), prompt = generatorDefinition.prompt, 
        modelObject = await aiutils.getAIModel(generatorDefinition.model),
        embeddingsModel = await aiutils.getAIModel(modelObject.embeddings_model),
        langDetected = langdetector.getISOLang(document),
        split_separators = embeddingsModel.split_separators[langDetected] || embeddingsModel.split_separators["*"],
        split_joiners = embeddingsModel.split_joiners[langDetected] || embeddingsModel.split_joiners["*"],
        splits = textsplitter.getSplits(document, embeddingsModel.request_chunk_size, 0, split_separators);

    const promptData = {}; for (const [key,value] of Object.entries(generatorDefinition)) {
        const keyNormalized = key.toLowerCase().trim();
        if (keyNormalized.startsWith(PROMPT_PARAM)) 
            promptData[keyNormalized.substring(PROMPT_PARAM.length, keyNormalized.length-1)] = value;
    }

    const rephrasedSplits = []; for (const split of splits) {
        promptData.fragment = split; 
        const rephrasedSplit = await simplellm.prompt_answer(prompt, fileindexer.id, fileindexer.org, promptData, modelObject);
        if (!rephrasedSplit) return {result: false};
        rephrasedSplits.push(rephrasedSplit);
    }

    return {result: true, contentBufferOrReadStream: _ => Buffer.from(rephrasedSplits.join(split_joiners[0]), 
        generatorDefinition.encoding||"utf8"), lang: langDetected};
}

module.exports = {generate}