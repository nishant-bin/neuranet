/**
 * This strategy is to first find matching documents using TF.IDF and 
 * then use their vectors for a sematic search to build the in-context 
 * training documents. This is a much superior search and memory strategy
 * to little embeddings vector search as it firsts finds the most relevant 
 * documents and the uses vectors only because the LLM prompt sizes are small. 
 * It also allows rejustments later to better train the LLMs.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);

const SEARCH_MODEL_DEFAULT = "chat-knowledgebase-gpt35-turbo";

exports.search = async function(id, org, query, aimodelToUse=SEARCH_MODEL_DEFAULT, lang="en") {
    const aiModelToUseForSearch = aimodelToUse, aiModelObjectForSearch = await aiutils.getAIModel(aiModelToUseForSearch);

    const tfidfDB = await aidbfs.getPrivateTFIDFDBForIDAndOrg(id, org, lang);
	const tfidfScoredDocuments = tfidfDB.query(query, aiModelObjectForSearch.topK_tfidf, null, 
		aiModelObjectForSearch.cutoff_score_tfidf);	// search using TF.IDF for matching documents first - only will use semantic search on vectors from these documents later
	if (tfidfScoredDocuments.length == 0) return [];	// no knowledge
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

	let vectordb; try { vectordb = await aidbfs.getPrivateVectorDBForIDAndOrg(id, org, embeddingsGenerator) } catch(err) { 
		LOG.error(`Can't instantiate the vector DB for ID ${id}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
	}
	const similarityResultsForPrompt = await vectordb.query(vectorForUserPrompts, aiModelObjectForSearch.topK_vectors, 
		aiModelObjectForSearch.min_distance_vectors, metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID]));
	if ((!similarityResultsForPrompt) || (!similarityResultsForPrompt.length)) return [];
    else return similarityResultsForPrompt;
}