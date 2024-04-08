/**
 * This strategy is to first find matching documents using TF.IDF and 
 * then use only their vectors for a sematic search to build the final 
 * answer. This is a much superior search and memory strategy to little 
 * embeddings vector search as it firsts finds the most relevant documents 
 * and the uses vectors only because the LLM prompt sizes are small. 
 * It also allows rejustments later to better train the LLMs.
 * 
 * @returns search returns array of {metadata, text} objects matching the 
 * 			resulting documents. The texts are shards of the document of
 * 			context length specified in the embedding generation model which
 * 			was used to ingest the documents.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);

const REASONS = {INTERNAL: "internal"};

/**
 * Searches the AI DBs for the given query. Strategy is documents are searched
 * first using keyword search, then for the top matching documents, vector shards
 * are returned for the relevant portions of the document which can answer the
 * query.
 * 
 * @param {Object} params Contains the following properties
 * 							id The ID of the logged in user 
 * 							The org of the logged in user's org
 * 							query The query to search for
 * 							metadata The metadata to condition on
 *                          search_metadata true if metadata is to be used to condition else false
 *                          topK_tfidf TopK for TD-IDF search
 *                          cutoff_score_tfidf Cutoff score for TF-IDF
 *                          topK_vectors TopK for vector search
 *                          min_distance_vectors Cutoff distance for vector search
 *                          embeddings_model The embedding model usually embedding-openai-ada002
 * @param {Object} _llmstepDefinition Not used.
 * 
 * @returns The search returns array of {metadata, text} objects matching the 
 * 			resulting documents. The texts are shards of the document of
 * 			context length specified in the embedding generation model which
 * 			was used to ingest the documents.
 */
exports.search = async function(params, _llmstepDefinition) {
	const id = params.id, org = params.org, query = params.query, aiModelObjectForSearch = {...params},
		brainid = params.brainid;

    const tfidfDBs = await aidbfs.getTFIDFDBsForIDAndOrgAndBrainID(id, org, brainid);
	let tfidfScoredDocuments = []; 
	for (const tfidfDB of tfidfDBs) { 
		const searchResults = await tfidfDB.query(query, aiModelObjectForSearch.topK_tfidf, null, aiModelObjectForSearch.cutoff_score_tfidf);
		if (searchResults && searchResults.length) tfidfScoredDocuments.push(...searchResults);
		else LOG.warn(`No TF.IDF search documents found for query ${query} for id ${id} org ${org} and brainid ${brainid}.`);
	}
	if (tfidfScoredDocuments.length == 0) return [];	// no knowledge

	// now we need to rerank these documents according to their TF score only (IDF is not material for this collection)
	tfidfDBs[0].sortForTF(tfidfScoredDocuments); tfidfScoredDocuments = tfidfScoredDocuments.slice(0, 
		(aiModelObjectForSearch.topK_tfidf < tfidfScoredDocuments.length ? aiModelObjectForSearch.topK_tfidf : tfidfScoredDocuments.length))

	const documentsToUseDocIDs = []; for (const tfidfScoredDoc of tfidfScoredDocuments) 
		documentsToUseDocIDs.push(tfidfScoredDoc.metadata[NEURANET_CONSTANTS.NEURANET_DOCID]);
	
	const aiModelObjectToUseForEmbeddings = await aiutils.getAIModel(aiModelObjectForSearch.embeddings_model.name,
		params.embeddings_model.model_overrides);
	const embeddingsGenerator = async text => {
		const response = await embedding.createEmbeddingVector(id, org, text, aiModelObjectToUseForEmbeddings); 
		if (response.reason != embedding.REASONS.OK) return null;
		else return response.embedding;
	}
	const vectorForUserPrompts = await embeddingsGenerator(query);
	if (!vectorForUserPrompts) {
		LOG.error(`Embedding vector generation failed for ${query}. Can't continue.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}

	let vectordbs; try { vectordbs = await aidbfs.getVectorDBsForIDAndOrgAndBrainID(id, org, brainid, 
			embeddingsGenerator, NEURANET_CONSTANTS.CONF.multithreaded) } catch(err) { 
		LOG.error(`Can't instantiate the vector DB for ID ${id}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
	}
	let vectorResults = [];
	for (const vectordb of vectordbs) vectorResults.push(...await vectordb.query(
		vectorForUserPrompts, aiModelObjectForSearch.topK_vectors, aiModelObjectForSearch.min_distance_vectors, 
			metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID])));
	if ((!vectorResults) || (!vectorResults.length)) return [];

	// slice the vectors after resorting as we combined DBs
	vectordbs[0].sort(vectorResults); vectorResults = vectorResults.slice(0, 
		(aiModelObjectForSearch.topK_vectors < vectorResults.length ? aiModelObjectForSearch.topK_vectors : vectorResults.length))
	
	const searchResults = []; for (const vectorResult of vectorResults) 
		searchResults.push({text: vectorResult.text, metadata: vectorResult.metadata});
    return searchResults;
}