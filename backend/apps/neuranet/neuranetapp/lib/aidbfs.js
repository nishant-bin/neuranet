/**
 * Unified interface for AI DB file handling. Other services should use this
 * for DB file ingestion, uningestion and update operations. 
 * 
 * Internally ingests into TF.IDF which  is useful for finding complete 
 * documents matching a query and the vector DB which is useful for finding 
 * semantic portion of the matching documents useful for answering the query.
 * 
 * Together these two AI DBs comprise the Neuranet knowledgebase which is 
 * then used for in-context training when the user is interacting with the AI. 
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);
const aitfidfdb = require(`${NEURANET_CONSTANTS.LIBDIR}/aitfidfdb.js`);
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);
const neuranetutils = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranetutils.js`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, 
	MODEL_DEFAULT = "embedding-openai-ada002", DEFAULT_ID = "unknownid", DEFAULT_ORG = "unknownorg", MASTER_DB = "masterdbid";

/**
 * Ingests the given file into the AI DBs.
 * @param {string} pathIn The path to the file
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} lang The language to use to ingest, defaults to English. Use ISO codes, e.g. "en"
 * @param {object} streamGenerator A read stream generator for this file, if available, else null
 * @param {boolean} dontRebuildDBs If true, the underlying DBs are not rebuilt. If this is used then the
 *                                 DBs must be manually rebuilt later.
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
async function ingestfile(pathIn, id, org, lang, streamGenerator, dontRebuildDBs) {
    LOG.info(`AI DB FS ingestion of file ${pathIn} for ID ${id} and org ${org} started.`);
    if (!(await quota.checkQuota(id))) {
		LOG.error(`Disallowing the ingest call for the path ${pathIn}, as the user ${id} of org ${org} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}
    
    const aiModelToUseForEmbeddings = MODEL_DEFAULT, aiModelObjectForEmbeddings = await aiutils.getAIModel(aiModelToUseForEmbeddings), 
        embeddingsGenerator = async text => {
			const response = await embedding.createEmbeddingVector(id, org, text, aiModelToUseForEmbeddings); 
			if (response.reason != embedding.REASONS.OK) return null;
			else return response.embedding;
		}
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgForIngestion(id, org, embeddingsGenerator) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectorDB_ID} for ID ${id} and org ${org}. Unable to continue.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const metadata = {id, date_created: Date.now(), fullpath: pathIn}; 
    metadata[NEURANET_CONSTANTS.NEURANET_DOCID] = _getDocID(pathIn);

    const _getExtractedTextStream = _ => _extractTextViaPluginsUsingStreams(streamGenerator ?
        streamGenerator() : fs.createReadStream(pathIn), aiModelObjectForEmbeddings, pathIn);

    // ingest into the TF.IDF DB
    const tfidfDB = await _getTFIDFDBForIDAndOrgForIngestion(id, org, lang); 
    try {
        LOG.info(`Starting text extraction of file ${pathIn}.`);
        const fileContents = await neuranetutils.readFullFile(await _getExtractedTextStream(), "utf8");
        LOG.info(`Ended text extraction, starting TFIDF ingestion of file ${pathIn}.`);
        tfidfDB.create(fileContents, metadata, dontRebuildDBs);
    } catch (err) {
        LOG.error(`TF.IDF ingestion failed for path ${pathIn} for ID ${id} and org ${org} with error ${err}.`); 
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
    }
    LOG.info(`Ended TFIDF ingestion of file ${pathIn}.`);

    // ingest into the vector DB
    LOG.info(`Starting Vector DB ingestion of file ${pathIn}.`);
	try { 
        await vectordb.ingeststream(metadata, await _getExtractedTextStream(), 
            aiModelObjectForEmbeddings.encoding, aiModelObjectForEmbeddings.chunk_size, 
            aiModelObjectForEmbeddings.split_separators, aiModelObjectForEmbeddings.overlap);
    } catch (err) { 
        //tfidfDB.delete(metadata);   // delete the file from tf.idf DB too to keep them in sync
        LOG.error(`Vector ingestion failed for path ${pathIn} for ID ${id} and org ${org} with error ${err}.`); 
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
    }
    LOG.info(`Ended Vector DB ingestion of file ${pathIn}.`);

    LOG.info(`AI DB FS ingestion of file ${pathIn} for ID ${id} and org ${org} succeeded.`);
    return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

/** 
 * Rebuilds the AI databases in memory used during ingestion.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} lang The language to use to ingest, defaults to English. Use ISO codes, e.g. "en"
 * @throws Exception on error
 */
async function rebuild(id, org, lang) {
    const tfidfDB = await _getTFIDFDBForIDAndOrgForIngestion(id, org, lang); 
    tfidfDB.rebuild();
}

/**
 * Flushes the databases to the file system used during ingestion.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} lang The language to use to ingest, defaults to English. Use ISO codes, e.g. "en"
 * @throws Exception on error
 */
async function flush(id, org, lang) {
    const tfidfDB = await _getTFIDFDBForIDAndOrgForIngestion(id, org, lang); 
    const vectordb = await _getVectorDBForIDAndOrgForIngestion(id, org, null);
    await tfidfDB.flush(); await vectordb.flush_db();
}

/**
 * Removes the given file from AI DBs.
 * @param {string} pathIn The path to the file
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} lang The language to use to ingest, defaults to English. Use ISO codes, e.g. "en"
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
async function uningestfile(pathIn, id, org, lang) {
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgForIngestion(id, org) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    // delete from the TF.IDF DB
    const docID = _getDocID(pathIn), tfidfDB = await _getTFIDFDBForIDAndOrgForIngestion(id, org, lang), 
        docsFound = tfidfDB.query(null, null, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID), 
        metadata = docsFound.length > 0 ? docsFound[0].metadata : null;
    if (!metadata) {
        LOG.error(`Document to uningest at path ${pathIn} for ID ${id} and org ${org} not found in the TF.IDF DB. Dropping the request.`);
        return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
    } else tfidfDB.delete(metadata);
    
    // delete from the Vector DB
    const queryResults = await vectordb.query(undefined, -1, undefined, 
        metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID, true);
    if (queryResults) for (const result of queryResults) {
        try {await vectordb.delete(result.vector);} catch (err) {
            LOG.error(`Error dropping vector for file ${pathIn} for ID ${id} and org ${org} failed. Some vectors were dropped. Database needs recovery for this file.`);
            LOG.debug(`The vector which failed was ${result.vector}.`);
            return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
        }
    } else {
        LOG.error(`Queyring vector DB for file ${pathIn} for ID ${id} and org ${org} failed.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    LOG.info(`Vector DB uningestion of file ${pathIn} for ID ${id} and org ${org} succeeded.`);
    return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

/**
 * Renames the given file in AI DB and their associated metadatas.
 * @param {string} from The path from
 * @param {string} to The path to
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} lang The language to use to ingest, defaults to English. Use ISO codes, e.g. "en"
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
async function renamefile(from, to, id, org, lang) {
    // update TF.IDF DB 
    const docID = _getDocID(pathIn), tfidfDB = await _getTFIDFDBForIDAndOrgForIngestion(id, org, lang), 
        docsFound = tfidfDB.query(null, null, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID), 
        metadata = docsFound.length > 0 ? docsFound[0].metadata : null, 
        newmetadata = {...metadata, fullpath: to}; 
    newmetadata[NEURANET_CONSTANTS.NEURANET_DOCID] = _getDocID(to);
    if (!metadata) {
        LOG.error(`Document to rename at path ${path} for ID ${id} and org ${org} not found in the TF.IDF DB. Dropping the request.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    } else tfidfDB.update(metadata, newmetadata);

    // update vector DB
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgForIngestion(id, org); } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const queryResults = await vectordb.query(undefined, -1, undefined, 
        metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID, true); 
    if (queryResults) for (const result of queryResults) {
        if (!vectordb.update(result.vector, newmetadata)) {
            LOG.error(`Renaming the vector file paths failed from path ${from} to path ${to} for ID ${id} and org ${org}.`);
            return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
        } 
    } else {
        LOG.error(`Queyring vector DB for file ${from} for ID ${id} and org ${org} failed.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    LOG.info(`Rename of file from ${from} to ${to} for ID ${id} and org ${org} succeeded.`)
    return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

/**
 * Returns the TF.IDF DB instances for the given ID, ORG and language. Useful for searching.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} lang The language to use to ingest, defaults to English. Use ISO codes, e.g. "en"
 * @returns The TF.IDF DB instances, throws an exception on error.
 */
async function getTFIDFDBsForIDAndOrg(id, org, lang="en") {
    const aifederationmode = await dblayer.getAIFederationModeForOrg(org);
    if (aifederationmode == "only_private") return [await _getPrivateTFIDFDBForIDAndOrg(id, org, lang)];
    if (aifederationmode == "only_master" || "master_and_private") {
        const tfidfdbMaster = await _getMasterTFIDFDBForOrg(org, lang);
        if (aifederationmode == "only_master" || (await login.isIDAdminForOrg(id, org))) return [tfidfdbMaster]; // admins control the master DB
        else return [await _getPrivateTFIDFDBForIDAndOrg(id, org, lang), tfidfdbMaster];
    }

    // todo: add mapped DBs logic here
}

/**
 * Returns the Vector DB instances for the given ID, ORG and embeddings generator. Useful for searching.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {function} embeddingsGenerator The vector embeddings generator to use. Function that takes text and returns a vector of floats.
 * @returns The Vector DB instances, throws an exception on error.
 */
async function getVectorDBsForIDAndOrg(id, org, embeddingsGenerator) {
    const aifederationmode = await dblayer.getAIFederationModeForOrg(org);
    if (aifederationmode == "only_private") return await _getPrivateVectorDBForIDAndOrg(id, org, lang);
    if (aifederationmode == "only_master" || "master_and_private") {
        const vectordbMaster = await _getMasterVectorDBForOrg(org, embeddingsGenerator);
        if (aifederationmode == "only_master" || (await login.isIDAdminForOrg(id, org))) return [vectordbMaster];  // admins control the master DB
        else return [await _getPrivateVectorDBForIDAndOrg(id, org, lang), vectordbMaster];
    }

    // todo: add mapped DBs logic here
}

/**
 * Returns the AI model to use for file handling. 
 * @param {string} modelName The model name, optional. Default is used otherwise.
 */
async function getAIModelForFiles(modelName) {
    const aiModelToUseForEmbeddings = modelName||MODEL_DEFAULT;
    const aiModelObjectForEmbeddings = await aiutils.getAIModel(aiModelToUseForEmbeddings);
    return aiModelObjectForEmbeddings;
}

async function _getPrivateVectorDBForIDAndOrg(id, org, embeddingsGenerator) {
    const vectordb = await aivectordb.get_vectordb(`${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(id, org)}/vectordb`, 
        embeddingsGenerator);
    return vectordb;
}

async function _getPrivateTFIDFDBForIDAndOrg(id, org, lang="en") {
    const tfidfdb = await aitfidfdb.get_tfidf_db(`${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(id, org)}/tfidfdb`, 
        NEURANET_CONSTANTS.NEURANET_DOCID, lang, `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`);
    return tfidfdb;
}

const _getMasterVectorDBForOrg = async (org, embeddingsGenerator) => await aivectordb.get_vectordb(
    `${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(MASTER_DB, org)}/vectordb`, embeddingsGenerator);

const _getMasterTFIDFDBForOrg = async (org, lang) => await aitfidfdb.get_tfidf_db(
    `${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(MASTER_DB, org)}/tfidfdb`, NEURANET_CONSTANTS.NEURANET_DOCID, lang, 
    `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`);

/** 
 * Admins always ingest into master. Other IDs always ingest into their private DBs. Regardless
 * of the AI federation modes. This also implies a single unified master DB for all admins. 
 */
const _getTFIDFDBForIDAndOrgForIngestion = async (id, org, lang) => await login.isIDAdminForOrg(id) ? 
    await _getMasterTFIDFDBForOrg(org, lang): await _getPrivateTFIDFDBForIDAndOrg(id, org, lang);
const _getVectorDBForIDAndOrgForIngestion = async (id, org, embeddingsGenerator) => await login.isIDAdminForOrg(id) ?
    await _getMasterVectorDBForOrg(org, embeddingsGenerator) : await _getPrivateVectorDBForIDAndOrg(id, org, embeddingsGenerator);

const _getDBID = (id, org) => `${(id||DEFAULT_ID).toLowerCase()}_${(org||DEFAULT_ORG).toLowerCase()}`;

async function _extractTextViaPluginsUsingStreams(inputstream, aiModelObject, filepath) {
    for (const textExtractor of aiModelObject.text_extraction_plugins) {
        const pluginThis = NEURANET_CONSTANTS.getPlugin(textExtractor); 
        const extractedTextStream = await pluginThis.getContentStream(inputstream, filepath);
        if (extractedTextStream) return extractedTextStream;
    } 

    throw new Error(`Unable to process the given file to extract the text.`);
}

const _getDocID = pathIn => crypto.createHash("md5").update(path.resolve(pathIn)).digest("hex");

module.exports = {ingestfile, uningestfile, renamefile, getAIModelForFiles, rebuild, flush, 
    getVectorDBsForIDAndOrg, getTFIDFDBsForIDAndOrg, REASONS, MODEL_DEFAULT, DEFAULT_ID, DEFAULT_ORG};