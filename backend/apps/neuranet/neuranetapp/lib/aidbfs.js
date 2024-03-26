/**
 * Unified interface for AI DB file handling. Other services should use this
 * for DB file ingestion, uningestion and update operations. 
 * 
 * Internally ingests into two databases - TF.IDF which  is useful for finding 
 * complete documents matching a query, and the vector DB which is useful for finding 
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
const stream = require("stream");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);
const aitfidfdb = require(`${NEURANET_CONSTANTS.LIBDIR}/aitfidfdb.js`);
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);
const neuranetutils = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranetutils.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/../3p/langdetector.js`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, 
	MODEL_DEFAULT = "embedding-openai-ada002", UNKNOWN_ORG = "unknownorg";

/**
 * Ingests the given file into the AI DBs.
 * @param {string} pathIn The path to the file
 * @param {string} referencelink The reference link for the document
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @param {string} lang The language to use to ingest. If omitted will be autodetected.
 * @param {object} streamGenerator A read stream generator for this file, if available, else null. Must be a text stream.
 * @param {boolean} dontRebuildDBs If true, the underlying DBs are not rebuilt. If this is used then the
 *                                 DBs must be manually rebuilt later.
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
async function ingestfile(pathIn, referencelink, id, org, brainid, lang, streamGenerator, dontRebuildDBs) {
    LOG.info(`AI DB FS ingestion of file ${pathIn} for ID ${id} and org ${org} started.`);
    if (!(await quota.checkQuota(id, org))) {
		LOG.error(`Disallowing the ingest call for the path ${pathIn}, as the user ${id} of org ${org} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}
    
    const aiModelToUseForEmbeddings = MODEL_DEFAULT, aiModelObjectForEmbeddings = await aiutils.getAIModel(aiModelToUseForEmbeddings), 
        embeddingsGenerator = async text => {
			const response = await embedding.createEmbeddingVector(id, org, text, aiModelToUseForEmbeddings); 
			if (response.reason != embedding.REASONS.OK) return null;
			else return response.embedding;
		}
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid, embeddingsGenerator) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectorDB_ID} for ID ${id} and org ${org}. Unable to continue.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const metadata = {id, date_created: Date.now(), fullpath: pathIn, referencelink:encodeURI(referencelink||_getDocID(pathIn))}; 
    metadata[NEURANET_CONSTANTS.NEURANET_DOCID] = _getDocID(pathIn);

    const _getExtractedTextStream = _ => streamGenerator ? streamGenerator() : fs.createReadStream(pathIn);

    // ingest into the TF.IDF DB
    const tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid); let fileContents; 
    try {
        LOG.info(`Starting text extraction of file ${pathIn}.`);
        fileContents = (await neuranetutils.readFullFile(await _getExtractedTextStream(), "utf8")).trim();
        if (!fileContents) throw new Error(`Empty file ${pathIn}, skipping AI ingestion`);
        LOG.info(`Ended text extraction, starting TFIDF ingestion of file ${pathIn}.`);
        if (!lang) {lang = langdetector.getISOLang(fileContents); LOG.info(`Autodetected language ${lang} for file ${pathIn}.`);}
        metadata.lang = lang; tfidfDB.create(fileContents, metadata, dontRebuildDBs, lang);
    } catch (err) {
        LOG.error(`TF.IDF ingestion failed for path ${pathIn} for ID ${id} and org ${org} with error ${err}.`); 
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
    }
    LOG.info(`Ended TFIDF ingestion of file ${pathIn}.`);

    // ingest into the vector DB
    LOG.info(`Starting Vector DB ingestion of file ${pathIn}.`);
	try { 
        const chunkSize = aiModelObjectForEmbeddings.vector_chunk_size[lang] || aiModelObjectForEmbeddings.vector_chunk_size["*"],
            split_separators = aiModelObjectForEmbeddings.split_separators[lang] || aiModelObjectForEmbeddings.split_separators["*"];
        await vectordb.ingeststream(metadata, fileContents ? stream.Readable.from(fileContents) : 
            await _getExtractedTextStream(), aiModelObjectForEmbeddings.encoding, chunkSize, 
                split_separators, aiModelObjectForEmbeddings.overlap);
    } catch (err) { 
        tfidfDB.delete(metadata);   // delete the file from tf.idf DB too to keep them in sync
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
 * @param {string} brainid The brain ID
 * @throws Exception on error
 */
async function rebuild(id, org, brainid) {
    const tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid); 
    tfidfDB.rebuild();
}

/**
 * Flushes the databases to the file system used during ingestion.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @throws Exception on error
 */
async function flush(id, org, brainid) {
    const tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid); 
    const vectordb = await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid, null);
    await tfidfDB.flush(); 
    await vectordb.flush_db();
}

/**
 * Removes the given file from AI DBs.
 * @param {string} pathIn The path to the file
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
async function uningestfile(pathIn, id, org, brainid) {
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid); } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    // delete from the TF.IDF DB
    const docID = _getDocID(pathIn), tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid), 
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
 * @param {string} new_referencelink The new reference link
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
async function renamefile(from, to, new_referencelink, id, org, brainid) {
    // update TF.IDF DB 
    const docID = _getDocID(from), tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid), 
        docsFound = tfidfDB.query(null, null, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID), 
        metadata = docsFound.length > 0 ? docsFound[0].metadata : null, 
        new_referencelink_encoded = encodeURI(new_referencelink||_getDocID(to)),
        newmetadata = {...(metadata||{}), referencelink: new_referencelink_encoded, fullpath: to}; 
    newmetadata[NEURANET_CONSTANTS.NEURANET_DOCID] = _getDocID(to);
    if (!metadata) {
        LOG.error(`Document to rename at path ${path} for ID ${id} and org ${org} not found in the TF.IDF DB. Dropping the request.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    } else tfidfDB.update(metadata, newmetadata);

    // update vector DB
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid); } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const queryResults = await vectordb.query(undefined, -1, undefined, 
        metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID); 
    if (queryResults) for (const result of queryResults) {
        if (!vectordb.update(result.vector, newmetadata, result.text)) {
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
 * Returns the TF.IDF DB instances for the given ID, ORG and brain IDs. Useful for searching only. 
 * Ingestion should be done via a CMS operation which auto-triggers this module.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @returns The TF.IDF DB instances, throws an exception on error.
 */
async function getTFIDFDBsForIDAndOrgAndBrainID(id, org, brainid) {
    return [await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid,)];
}

/**
 * Returns the Vector DB instances for the given ID, ORG, brain ID and embeddings generator. 
 * Useful for searching only. Ingestion should be done via a CMS operation which 
 * auto-triggers this module.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @param {function} embeddingsGenerator The vector embeddings generator to use. Function that takes text and returns a vector of floats.
 * @param {boolean} multithreaded Should the vector DB run multithreaded
 * @returns The Vector DB instances, throws an exception on error.
 */
async function getVectorDBsForIDAndOrgAndBrainID(id, org, brainid, embeddingsGenerator, multithreaded) {
    return [await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid, embeddingsGenerator, multithreaded)];
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

async function _getVectorDBForIDAndOrgAndBrainID(id, org, brainid, embeddingsGenerator, multithreaded) {
    // TODO: ensure the brainid which is same as aiappid is mapped to the user here as a security check
    const vectordb = await aivectordb.get_vectordb(`${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(id, org, brainid)}/vectordb`, 
        embeddingsGenerator, multithreaded);
    return vectordb;
}

async function _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid) {
    // TODO: ensure the brainid which is same as aiappid is mapped to the user here as a security check
    const tfidfdb = await aitfidfdb.get_tfidf_db(`${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(id, org, brainid)}/tfidfdb`, 
        NEURANET_CONSTANTS.NEURANET_DOCID, NEURANET_CONSTANTS.NEURANET_LANGID, `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`);
    return tfidfdb;
}

const _getDBID = (_id, org, brainid) => `${(org||UNKNOWN_ORG).toLowerCase()}/${brainid}`;

const _getDocID = pathIn => crypto.createHash("md5").update(path.resolve(pathIn)).digest("hex");

module.exports = {ingestfile, uningestfile, renamefile, getAIModelForFiles, rebuild, flush, 
    getVectorDBsForIDAndOrgAndBrainID, getTFIDFDBsForIDAndOrgAndBrainID};