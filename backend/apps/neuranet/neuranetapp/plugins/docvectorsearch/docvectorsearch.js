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
 * 							org The org of the logged in user's org
 * 							query The query to search for
 * 							brainid The AI application ID for the DB to search
 *                          topK_tfidf TopK for TD-IDF search
 *                          cutoff_score_tfidf Cutoff score for TF-IDF
 *                          topK_vectors TopK for vector search
 *                          min_distance_vectors Cutoff distance for vector search
 *                          embeddings_model The embedding model usually embedding-openai-ada002
 * 							autocorrect_query Default is true, set to false to turn off
 * @param {Object} _llmstepDefinition Not used.
 * 
 * @returns The search returns array of {metadata, text} objects matching the 
 * 			resulting documents. The texts are shards of the document of
 * 			context length specified in the embedding generation model which
 * 			was used to ingest the documents.
 */
exports.search = async function(params, _llmstepDefinition) {
	const id = params.id, org = params.org, query = params.query, aiModelObjectForSearch = {...params},
		brainids = params.bridges?Array.isArray(params.bridges)?params.bridges:[params.bridges]:[params.aiappid], 
		primary_brain = params.aiappid, 
		metadata_filter_function = params.metadata_filter_function ? new Function("metadata", params.metadata_filter_function) : undefined;
	if (!aiModelObjectForSearch.autocorrect_query) aiModelObjectForSearch.autocorrect_query = true;
	const autoCorrectQuery = params.request.autocorrect_query !== undefined ? params.request.autocorrect_query : aiModelObjectForSearch.autocorrect_query;
	const topK = params.request.topk || aiModelObjectForSearch.topK_tfidf;
	const cutoff_score_tfidf = params.request.cutoff_score_tfidf || aiModelObjectForSearch.cutoff_score_tfidf;

    const tfidfDBs = []; for (const brainidThis of brainids) tfidfDBs.push(...await aidbfs.getTFIDFDBsForIDAndOrgAndBrainID(id, org, brainidThis));
	if (!tfidfDBs.length) {	// no TF.IDF DB worked or found
		const errMsg = `Can't instantiate any TF.IDF DBs user ID ${id}. Giving up.`;
		params.return_error(errMsg, REASONS.INTERNAL); return;
	}
	let tfidfScoredDocuments = []; 
	for (const tfidfDB of tfidfDBs) { 
		const searchResults = await tfidfDB.query(query, topK, metadata_filter_function, cutoff_score_tfidf, 
			undefined, undefined, autoCorrectQuery);
		if (searchResults && searchResults.length) tfidfScoredDocuments.push(...searchResults);
		else LOG.warn(`No TF.IDF search documents found for query ${query} for id ${id} org ${org} and brainid ${brainids}.`);
	}
	if (tfidfScoredDocuments.length == 0) return _formatResults(params, []);	// no knowledge

	// now we need to rerank these documents according to their TF score only (IDF is not material for this collection)
	tfidfDBs[0].sortForTF(tfidfScoredDocuments); tfidfScoredDocuments = tfidfScoredDocuments.slice(0, 
		(topK < tfidfScoredDocuments.length ? topK : tfidfScoredDocuments.length))

	const documentsToUseDocIDs = []; for (const tfidfScoredDoc of tfidfScoredDocuments) 
		documentsToUseDocIDs.push(tfidfScoredDoc.metadata[NEURANET_CONSTANTS.NEURANET_DOCID]);
	
	const aiModelObjectToUseForEmbeddings = await aiapp.getAIModel(aiModelObjectForSearch.embeddings_model.name,
		aiModelObjectForSearch.embeddings_model.model_overrides, id, org, primary_brain);
	const embeddingsGenerator = async text => {
		const response = await embedding.createEmbeddingVector(id, org, primary_brain, text, aiModelObjectToUseForEmbeddings); 
		if (response.reason != embedding.REASONS.OK) return null;
		else return response.embedding;
	}
	const vectorForUserPrompts = await embeddingsGenerator(query);
	if (!vectorForUserPrompts) {
		const err = `Embedding vector generation failed for ${query}. Can't continue.`;
		LOG.error(err); params.return_error(err, REASONS.INTERNAL); return;
	}

	let vectordbs = []; for (const brainidThis of brainids) {
		try {
			vectordbs.push(...await aidbfs.getVectorDBsForIDAndOrgAndBrainID(id, org, brainidThis, embeddingsGenerator, 
				NEURANET_CONSTANTS.CONF.multithreaded)) 
		} catch (err) { 
			const errMsg = `Can't instantiate the vector DB for brain ID ${brainidThis} user ID ${id} due to ${err}. Skipping this DB.`;
			LOG.error(errMsg); continue;
		}
	} 
	if (!vectordbs.length) {	// no vector DB worked or found
		const errMsg = `Can't instantiate any vector DBs user ID ${id} due to ${err}. Giving up.`;
		params.return_error(errMsg, REASONS.INTERNAL); return;
	}
	let vectorResults = []; const topK_vectors = params.request.topk || aiModelObjectForSearch.topK_vectors;
	const min_distance_vectors = params.request.min_distance_vectors || aiModelObjectForSearch.min_distance_vectors;
	for (const vectordb of vectordbs) vectorResults.push(...(await vectordb.query(vectorForUserPrompts, topK_vectors, 
		min_distance_vectors, metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID]))));
	if ((!vectorResults) || (!vectorResults.length)) {
		LOG.warn(`No vector search documents found for query ${query} for id ${id} org ${org} and brainid ${brainids}.`);
		return _formatResults(params, [])
	}

	// slice the vectors after resorting as we combined DBs
	vectordbs[0].sort(vectorResults); vectorResults = vectorResults.slice(0, 
		(topK_vectors < vectorResults.length ? topK_vectors : vectorResults.length))
	
	return _formatResults(params, vectorResults);
}

function _formatResults(params, searchResultsTopK) {
	const searchResults = []; for (const searchResultTopKThis of searchResultsTopK) 
		if (!params.request.llm_format) searchResults.push({text: searchResultTopKThis.text, metadata: searchResultTopKThis.metadata});
		else searchResults.push(searchResultTopKThis.text);
    return params.request.llm_format?searchResults.join("\n\n"):searchResults;
}