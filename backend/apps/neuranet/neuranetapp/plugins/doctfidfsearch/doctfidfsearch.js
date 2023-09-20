/**
 * This strategy is to first find matching documents using TF.IDF and 
 * then use only their vectors for another TF search to build the final 
 * answer. This strategy works good for non-English languages, specially
 * Japanese and Chinese.
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
const aitfidfdb = require(`${NEURANET_CONSTANTS.LIBDIR}/aitfidfdb.js`);

const SEARCH_MODEL_DEFAULT = "chat-knowledgebase-gpt35-turbo", REASONS = {INTERNAL: "internal"},
	TEMP_MEM_TFIDF_ID = "_com_tekmonks_neuranet_tempmem_tfidfdb_id_";

/**
 * Searches the AI DBs for the given query. Strategy is documents are searched
 * first using keyword search, then for the top matching documents, vector shards
 * are returned for the relevant portions of the document which can answer the
 * query.
 * @param {string} id The ID of the logged in user 
 * @param {string} org The ID of the logged in user's org
 * @param {string} query The query to search for
 * @param {string} aimodelToUse The name of the Neuranet AI model to use, optional.
 * 								Defaults to chat-knowledgebase-gpt35-turbo.
 * @returns The search returns array of {metadata, text} objects matching the 
 * 			resulting documents. The texts are shards of the document of
 * 			context length specified in the embedding generation model which
 * 			was used to ingest the documents.
 */
exports.search = async function(id, org, query, aimodelToUse=SEARCH_MODEL_DEFAULT) {
    const aiModelToUseForSearch = aimodelToUse, aiModelObjectForSearch = await aiutils.getAIModel(aiModelToUseForSearch);

    const tfidfDBs = await aidbfs.getTFIDFDBsForIDAndOrg(id, org);
	let tfidfScoredDocuments = []; 
	for (const tfidfDB of tfidfDBs) tfidfScoredDocuments.push(
		...tfidfDB.query(query, aiModelObjectForSearch.topK_tfidf, null, aiModelObjectForSearch.cutoff_score_tfidf));	
	if (tfidfScoredDocuments.length == 0) return [];	// no knowledge

	// now we need to rerank these documents according to their TF score only (IDF is not material for this collection)
	tfidfDBs[0].sortForTF(tfidfScoredDocuments); tfidfScoredDocuments = tfidfScoredDocuments.slice(0, 
		(aiModelObjectForSearch.topK_tfidf < tfidfScoredDocuments.length ? aiModelObjectForSearch.topK_tfidf : tfidfScoredDocuments.length))

	const documentsToUseDocIDs = []; for (const tfidfScoredDoc of tfidfScoredDocuments) 
		documentsToUseDocIDs.push(tfidfScoredDoc.metadata[NEURANET_CONSTANTS.NEURANET_DOCID]);
	
	let vectordbs; try { vectordbs = await aidbfs.getVectorDBsForIDAndOrg(id, org, undefined, 
			NEURANET_CONSTANTS.CONF.multithreaded) } catch(err) { 
		LOG.error(`Can't instantiate the vector DB for ID ${id}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
	}
	let vectorResults = [];
	for (const vectordb of vectordbs) vectorResults.push(...await vectordb.query(	// just get all the vectors for these documents
		undefined, undefined, undefined, metadata => documentsToUseDocIDs.includes(
			metadata[NEURANET_CONSTANTS.NEURANET_DOCID])));
	if ((!vectorResults) || (!vectorResults.length)) return [];

	// create an in-memory temporary TF.IDF DB to search for relevant vectors
	const tfidfDBInMem = await aitfidfdb.get_tfidf_db(TEMP_MEM_TFIDF_ID+Date.now(), NEURANET_CONSTANTS.NEURANET_DOCID, 
		NEURANET_CONSTANTS.NEURANET_LANGID, `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`, undefined, undefined, 
		undefined, true);
	for (const vectorResult of vectorResults) {
		vectorResult.metadata.__uniqueid = Date.now() + Math.random();
		vectorResult.metadata[NEURANET_CONSTANTS.NEURANET_DOCID] = vectorResult.metadata.__uniqueid;	// ensure these are all treated as seeprate documents
		tfidfDBInMem.create(vectorResult.text, vectorResult.metadata, true); } tfidfDBInMem.rebuild(); 
	const tfidfVectors = tfidfDBInMem.query(query), searchResultsAll = tfidfDBInMem.sortForTF(tfidfVectors), 
		tfidfSearchResultsTopK = searchResultsAll.slice(0, aiModelObjectForSearch.topK_vectors);
	tfidfDBInMem.free_memory();

	const searchResultsTopK = []; for (const tfidfSearchResultTopKThis of tfidfSearchResultsTopK) 
		searchResultsTopK.push(...(vectorResults.filter(vectorResult => vectorResult.metadata.__uniqueid == tfidfSearchResultTopKThis.metadata.__uniqueid)));
    return searchResultsTopK;
}