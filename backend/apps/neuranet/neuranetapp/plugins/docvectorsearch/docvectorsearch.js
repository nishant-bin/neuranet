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
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);

const REASONS = llmflowrunner.REASONS;

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
	
	const aiModelObjectToUseForEmbeddings = await aiapp.getAIModel(aiModelObjectForSearch.embeddings_model.name,
		aiModelObjectForSearch.embeddings_model.model_overrides, id, org, brainid);
	const embeddingsGenerator = async text => {
		const response = await embedding.createEmbeddingVector(id, org, brainid, text, aiModelObjectToUseForEmbeddings); 
		if (response.reason != embedding.REASONS.OK) return null;
		else return response.embedding;
	}
	const vectorForUserPrompts = await embeddingsGenerator(query);
	if (!vectorForUserPrompts) {
		const err = `Embedding vector generation failed for ${query}. Can't continue.`;
		LOG.error(err); params.return_error(err, REASONS.INTERNAL); return;
	}

	let vectordbs; try { vectordbs = await aidbfs.getVectorDBsForIDAndOrgAndBrainID(id, org, brainid, 
			embeddingsGenerator, NEURANET_CONSTANTS.CONF.multithreaded) } catch(err) { 
		const errMsg = `Vector DB lookup failed due to ${err}. Can't continue.`;
		LOG.error(errMsg); params.return_error(errMsg, REASONS.INTERNAL); return;
	}
	let vectorResults = [];
	for (const vectordb of vectordbs) vectorResults.push(...(await vectordb.query(
		vectorForUserPrompts, aiModelObjectForSearch.topK_vectors, aiModelObjectForSearch.min_distance_vectors, 
			metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID]))));
	if ((!vectorResults) || (!vectorResults.length)) {
		LOG.warn(`No vector search documents found for query ${query} for id ${id} org ${org} and brainid ${brainid}.`);
		return [];
	}

	// slice the vectors after resorting as we combined DBs
	vectordbs[0].sort(vectorResults); vectorResults = vectorResults.slice(0, 
		(aiModelObjectForSearch.topK_vectors < vectorResults.length ? aiModelObjectForSearch.topK_vectors : vectorResults.length))
	
	const searchResults = []; for (const vectorResult of vectorResults) 
		searchResults.push({text: vectorResult.text, metadata: vectorResult.metadata});
    return searchResults;
}