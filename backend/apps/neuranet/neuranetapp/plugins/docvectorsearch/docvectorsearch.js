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
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);

const SEARCH_MODEL_DEFAULT = "chat-knowledgebase-gpt35-turbo";

exports.search = async function(id, org, query, aimodelToUse=SEARCH_MODEL_DEFAULT, lang="en") {
    const aiModelToUseForSearch = aimodelToUse, aiModelObjectForSearch = await aiutils.getAIModel(aiModelToUseForSearch);

    const tfidfDBs = await aidbfs.getTFIDFDBsForIDAndOrg(id, org, lang);
	let tfidfScoredDocuments = []; 
	for (const tfidfDB of tfidfDBs) tfidfScoredDocuments.push(
		tfidfDB.query(query, aiModelObjectForSearch.topK_tfidf, null, aiModelObjectForSearch.cutoff_score_tfidf));	
	if (tfidfScoredDocuments.length == 0) return [];	// no knowledge

	// now we need to rerank these documents according to their TF score only (IDF is not material for this collection)
	tfidfScoredDocuments.sort((doc1, doc2) => doc1.tf_score < doc2.tf_score ? 1 : doc1.tf_score > doc2.tf_score ? -1 : 0);
	tfidfScoredDocuments = tfidfScoredDocuments.slice(0, (aiModelObjectForSearch.topK_tfidf < 
		tfidfScoredDocuments.length ? aiModelObjectForSearch.topK_tfidf : tfidfScoredDocuments.length))

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
	let similarityResultsForPrompt = [];
	for (const vectordb of vectordbs) similarityResultsForPrompt.push(await vectordb.query(
		vectorForUserPrompts, aiModelObjectForSearch.topK_vectors, aiModelObjectForSearch.min_distance_vectors, 
			metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID])));
	if ((!similarityResultsForPrompt) || (!similarityResultsForPrompt.length)) return [];

	// slice the vectors after resorting as we combined DBs
	similarityResultsForPrompt.sort((a,b) => b.similarity - a.similarity);
	similarityResultsForPrompt = similarityResultsForPrompt.slice(0, (aiModelObjectForSearch.topK_vectors < 
		similarityResultsForPrompt.length ? aiModelObjectForSearch.topK_vectors : similarityResultsForPrompt.length))
    return similarityResultsForPrompt;
}