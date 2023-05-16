/**
 * Indexes a new document into the backend vector store knowledge base. 
 * The DB id can be used to split the backend into multiple vector stores, 
 * thus, building multiple knowledge bases.
 * 
 * API Request
 * 	id - the user ID
 *  db - optional but strongly recommended to ensure split databases for 
 *       faster responses, database id/name to injest into 
 *  document - the document to injest
 *  metadata - the document metadata
 *  model - (optional) the AI model to use to create the embeddings
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, 
	MODEL_DEFAULT = "embedding-openai-ada002";

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got index document request from ID ${jsonReq.id}. Incoming request metadata is ${JSON.stringify(jsonReq.metadata)}`);

	if (!(await quota.checkQuota(jsonReq.id))) {
		LOG.error(`Disallowing the API call, as the user ${jsonReq.id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

    const aiModelToUseForEmbeddings = jsonReq.model || MODEL_DEFAULT, 
		aiModelObjectForEmbeddings = aiutils.getAIModel(aiModelToUseForEmbeddings), 
		vectorDB_ID = jsonReq.db||aiModelObjectForEmbeddings.default_vector_db,
        embeddingsGenerator = text => embedding.createEmbeddingVector(jsonReq.id, text, aiModelToUseForEmbeddings); 
    const vectordb = aivectordb.get_vectordb(`${NEURANET_CONSTANTS.VECTORDBPATH}/${vectorDB_ID}`, embeddingsGenerator);
	const ingestedVectors = await vectordb.ingest(jsonReq.metadata, jsonReq.document, 
		aiModelObjectForEmbeddings.chunk_size, aiModelObjectForEmbeddings.split_separator, 
		aiModelObjectForEmbeddings.overlap);

	if (!ingestedVectors) {
		LOG.error(`AI library error indexing document for request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else return {vectors: ingestedVectors, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.document && jsonReq.metadata);