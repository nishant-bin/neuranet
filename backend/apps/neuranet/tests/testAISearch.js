/**
 * Tests overall AI search using AI DBs and algorithms inside them.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aitfidfdb = require(`${NEURANET_CONSTANTS.LIBDIR}/aitfidfdb.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);

const TEST_ID = "test@tekmonks.com", EMBEDDING_MODEL = "embedding-openai-ada002";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aisearch")) {
        LOG.console(`Skipping TF.IDF DB test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing DB root path.\n"); return;} 
    if (!argv[2]) {LOG.console("Missing search query.\n"); return;} 

    const _testFailed = err => {const error=`Error AI search testing failed.${err?" Error was "+err:""}\n`; LOG.error(error); LOG.console(error);}
    try{
        const queryResult = await _testSearch(path.resolve(argv[1]), argv[2]);  // test query
        if (!queryResult) {_testFailed("Search failed."); return false;}
        const output = JSON.stringify(queryResult, null, 2); 
        LOG.info(output); LOG.console(output);
    } catch (err) {_testFailed(err); return false;}
}

async function _testSearch(dbroot, query, lang="en") {
    const tfidfDB = await _getTFIDFDBForPath(dbroot, lang);  
    const tfidfScoredDocuments = tfidfDB.query(query, 3, null, 0.6);
    if (!tfidfScoredDocuments) return null;
    const logMsg = `TF.IDF Query result is ${JSON.stringify(tfidfScoredDocuments, null, 2)}.\n`; LOG.info(logMsg); LOG.console(logMsg);

    const documentsToUseDocIDs = []; for (const tfidfScoredDoc of tfidfScoredDocuments) 
		documentsToUseDocIDs.push(tfidfScoredDoc.metadata[NEURANET_CONSTANTS.NEURANET_DOCID]);

    const embeddingsGenerator = async text => {
		const response = await embedding.createEmbeddingVector(TEST_ID, text, EMBEDDING_MODEL); 
		if (response.reason != embedding.REASONS.OK) return null;
		else return response.embedding;
	}
	const vectorForUserPrompts = await embeddingsGenerator(query);
	if (!vectorForUserPrompts) {
		LOG.error(`Embedding vector generation failed for ${EMBEDDING_MODEL}. Can't continue.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}

	const vectordb = await _getVectorDBForPath(dbroot, embeddingsGenerator);
	const similarityResults = await vectordb.query(vectorForUserPrompts, 3, 
		0.6, metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID]));
	if ((!similarityResults) || (!similarityResults.length)) return null;
	const documents = [], metadatasForResponse = []; for (const [i,similarityResult] of similarityResults.entries()) {
		documents.push({content: similarityResult.text, document_index: i+1}); metadatasForResponse.push(similarityResult.metadata) };

    return {tfidfScoredDocuments, metadatasForResponse, documents};
}

async function _getTFIDFDBForPath(dbpath, lang) {
    const tfidfdb = await aitfidfdb.get_tfidf_db(`${dbpath}/tfidfdb`, NEURANET_CONSTANTS.NEURANET_DOCID, lang,
        `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`);
    return tfidfdb;
}

async function _getVectorDBForPath(dbpath, embeddingsGenerator) {
    const vectordb = await aivectordb.get_vectordb(`${dbpath}/vectordb`, embeddingsGenerator);
    return vectordb;
}