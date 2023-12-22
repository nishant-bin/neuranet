/**
 * AI based embedding generator.
 * 
 * Output is 
 * {embedding: The vector, error: null on success or error reason on error, reason: OK, or other reasons on failure}
 * 
 * The default model is embedding-openai-ada002.
 *  
 * (C) 2023 TekMonks. All rights reserved.
 */
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);

const MODEL_DEFAULT = "embedding-openai-ada002", EMBEDDING_PROMPT = `${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/embedding_prompt.txt`,
    REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", LIMIT: "limit"}

async function createEmbeddingVector(id, org, text, model) {
    if (!(await quota.checkQuota(id, org))) {
		LOG.error(`Disallowing the embedding call, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, error: "User is over quota limit."};
	}

    const aiModelToUse = jsonReq.model || MODEL_DEFAULT, aiModelObject = await aiutils.getAIModel(aiModelToUse),
        aiKey = crypt.decrypt(aiModelObject.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse].driver.module}`;
	let aiLibrary; try{aiLibrary = require(aiModuleToUse);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, error: err};
	}
	
	const response = await aiLibrary.process({text}, EMBEDDING_PROMPT, aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request for embedding ${text}`); 
		return {reason: REASONS.INTERNAL, error: "AI library error."};
	} else {
        dblayer.logUsage(id, response.metric_cost||0, aiModelToUse);
		return {reason: REASONS.OK, embedding: response.airesponse};
	}
}

module.exports = {createEmbeddingVector, REASONS};