/**
 * This strategy is to first find matching documents using TF.IDF and 
 * then use only their vectors for a sematic search to build the final 
 * answer. This is a much superior search and memory strategy to little 
 * embeddings vector search as it firsts finds the most relevant documents 
 * and the uses vectors only because the LLM prompt sizes are small. 
 * It also allows rejustments later to better train the LLMs.
 * 
 * @returns search returns array of {vector, similarity, metadata, text} 
 * 			objects matching the results.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);

const SEARCH_MODEL_DEFAULT = "chat-knowledgebase-gpt35-turbo";

exports.search = async function(id, org, query, aimodelToUse=SEARCH_MODEL_DEFAULT, lang="en") {
    const aiModelToUseForSearch = aimodelToUse, aiModelObjectForSearch = await aiutils.getAIModel(aiModelToUseForSearch);

    const tfidfDBs = await aidbfs.getTFIDFDBsForIDAndOrg(id, org, lang);
	let tfidfScoredDocuments = []; 
	for (const tfidfDB of tfidfDBs) tfidfScoredDocuments.push(
		...tfidfDB.query(query, aiModelObjectForSearch.topK_tfidf, null, aiModelObjectForSearch.cutoff_score_tfidf));	
	if (tfidfScoredDocuments.length == 0) return [];	// no knowledge

	// now we need to rerank these documents according to their TF score only (IDF is not material for this collection)
	tfidfDBs[0].sortForTF(tfidfScoredDocuments); tfidfScoredDocuments = tfidfScoredDocuments.slice(0, 
		(aiModelObjectForSearch.topK_tfidf < tfidfScoredDocuments.length ? aiModelObjectForSearch.topK_tfidf : tfidfScoredDocuments.length))

	const documentsToUseDocIDs = []; for (const tfidfScoredDoc of tfidfScoredDocuments) 
		documentsToUseDocIDs.push(tfidfScoredDoc.metadata[NEURANET_CONSTANTS.NEURANET_DOCID]);
	
	const aiModelToUseForEmbeddings = aiModelObjectForSearch.embeddings_model;
	const embeddingsGenerator = async text => {
		const response = await embedding.createEmbeddingVector(id, text, aiModelToUseForEmbeddings); 
		if (response.reason != embedding.REASONS.OK) return null;
		else return response.embedding;
	}
	const vectorForUserPrompts = await embeddingsGenerator(query);
	if (!vectorForUserPrompts) {
		LOG.error(`Embedding vector generation failed for ${query}. Can't continue.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}

	let vectordbs; try { vectordbs = await aidbfs.getVectorDBsForIDAndOrg(id, org, embeddingsGenerator) } catch(err) { 
		LOG.error(`Can't instantiate the vector DB for ID ${id}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
	}
	let vectorResultsForPrompt = [];
	for (const vectordb of vectordbs) vectorResultsForPrompt.push(...await vectordb.query(
		vectorForUserPrompts, aiModelObjectForSearch.topK_vectors, aiModelObjectForSearch.min_distance_vectors, 
			metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID])));
	if ((!vectorResultsForPrompt) || (!vectorResultsForPrompt.length)) return [];

	// slice the vectors after resorting as we combined DBs
	vectordbs[0].sort(vectorResultsForPrompt); vectorResultsForPrompt = vectorResultsForPrompt.slice(0, 
		(aiModelObjectForSearch.topK_vectors < vectorResultsForPrompt.length ? aiModelObjectForSearch.topK_vectors : vectorResultsForPrompt.length))
    return vectorResultsForPrompt;
}