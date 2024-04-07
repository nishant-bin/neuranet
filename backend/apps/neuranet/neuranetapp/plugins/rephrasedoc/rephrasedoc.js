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

const PROMPT_PARAM = "_promptparam", CHAT_MODEL = "chat", EMBEDDINGS_MODEL = "embeddings";

async function generate(fileindexer, generatorDefinition) {
    let chatModelDefinition, embeddingsModelDefinition; for (const model of (generatorDefinition.models||[])) {
        if (model.type == CHAT_MODEL) chatModelDefinition = model;
        if (model.type == EMBEDDINGS_MODEL) embeddingsModelDefinition = model;
    }
    if ((!chatModelDefinition) || (!embeddingsModelDefinition)) {
        LOG.error(`Generation failed for ${fileindexer.filepath} due to bad model definitions in the AI application.`) ; 
        return {result: false};
    }

    let document = await fileindexer.getTextContents(generatorDefinition.encoding||"utf8");
    if (!document) {LOG.error(`File content extraction failed for ${fileindexer.filepath}.`); return {result: false};}
    document = document.replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ");

    const modelObject = await aiutils.getAIModel(chatModelDefinition.name, chatModelDefinition.model_overrides),
        embeddingsModel = await aiutils.getAIModel(embeddingsModelDefinition.name, embeddingsModelDefinition.model_overrides);

    const langDetected = langdetector.getISOLang(document),
        split_separators = embeddingsModel.split_separators[langDetected] || embeddingsModel.split_separators["*"],
        split_joiners = embeddingsModel.split_joiners[langDetected] || embeddingsModel.split_joiners["*"],
        split_size = embeddingsModel.request_chunk_size[langDetected] || embeddingsModel.request_chunk_size["*"],
        splits = textsplitter.getSplits(document, split_size, split_separators, 0);

    const promptData = {lang: langDetected}; for (const [key,value] of Object.entries(generatorDefinition)) {
        const keyNormalized = key.toLowerCase().trim();
        if (keyNormalized.endsWith(PROMPT_PARAM)) promptData[aiapp.extractRawKeyName(key)] = value;
    }

    const rephrasedSplits = []; for (const split of splits) {
        const lang_fragment = langdetector.getISOLang(split);
        promptData.fragment = split; promptData.lang_fragment = lang_fragment;
        const promptToUse = generatorDefinition[`prompt_fragment_${lang_fragment}`] || generatorDefinition[`prompt_${langDetected}`] || generatorDefinition.prompt;
        const rephrasedSplit = await simplellm.prompt_answer(promptToUse, fileindexer.id, fileindexer.org, promptData, modelObject);
        if (!rephrasedSplit) continue;
        rephrasedSplits.push(rephrasedSplit);
    }
    const joinedConent = rephrasedSplits.join(split_joiners[0]);

    return {result: true, contentBufferOrReadStream: _ => Buffer.from(joinedConent, generatorDefinition.encoding||"utf8"), lang: langDetected};
}

module.exports = {generate}