/**
 * Will index files including XBin documents in and out of 
 * the AI databases. Currently uses two of them TF.IDF which  
 * iis useful for finding complete documents matching a query 
 * and the vector DB which is useful for finding semantic portions
 * of the matching documents useful for answering the query.
 * 
 * Together these two AI DBs comprise the Neuranet knowledgebase
 * which is then used for in-context training when the user is 
 * chatting with the AI. 
 * 
 * Bridge between drive documents including XBin and Neuranet 
 * knowledgebases.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See enclosed LICENSE file.
 */

const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);
const aitfidfdb = require(`${NEURANET_CONSTANTS.LIBDIR}/aitfidfdb.js`);
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);
const downloadfile = require(`${XBIN_CONSTANTS.API_DIR}/downloadfile.js`);

REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, 
	MODEL_DEFAULT = "embedding-openai-ada002", DEFAULT_ID = "unknownid", DEFAULT_ORG = "unknownorg";

exports.init = _ => blackboard.subscribe(XBIN_CONSTANTS.XBINEVENT, message => _handleFileEvent(message));

async function _handleFileEvent(message) {
    const awaitPromisePublishFileEvent = async (promise, path, return_vectors, type, id, org) => {  // this is mostly to inform listeners about file being processed events
        // we have started processing a file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, { type: NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSING, 
            result: true, vectors: undefined, subtype: type, id, org, path,
            cmspath: await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, path) });
        const result = await promise;   // wait for it to complete
        // we have finished processing this file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED, 
            path, result: result?result.result:false, vectors: return_vectors ? result.vectors : undefined, subtype: type, id, org,
            cmspath: await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, path)});
    }

    if (message.type == XBIN_CONSTANTS.EVENTS.FILE_CREATED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.isxbin, message.lang), 
            message.path, message.return_vectors, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.INGESTED, 
            message.id, message.org);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_DELETED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_uningestfile(path.resolve(message.path), message.id, message.org, message.lang), 
            message.path, message.return_vectors, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.UNINGESTED,
            message.id, message.org);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_RENAMED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_renamefile(path.resolve(message.from), path.resolve(message.to), message.id, 
            message.org, message.lang), message.to, message.return_vectors, 
            NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.RENAMED, message.id, message.org);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_MODIFIED && (!message.isDirectory)) {
        await _uningestfile(path.resolve(message.path), message.id, message.org, message.lang);
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.isxbin, message.lang), 
            message.path, message.return_vectors, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.MODIFIED,
            message.id, message.org);
    }
}

async function _ingestfile(pathIn, id, org, isxbin, lang) {
    if (!(await quota.checkQuota(id))) {
		LOG.error(`Disallowing the ingest call for the path ${pathIn}, as the user ${id} of org ${org} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

    const aiModelToUseForEmbeddings = MODEL_DEFAULT, aiModelObjectForEmbeddings = await aiutils.getAIModel(aiModelToUseForEmbeddings), 
        embeddingsGenerator = async text => {
			const response = await embedding.createEmbeddingVector(id, text, aiModelToUseForEmbeddings); 
			if (response.reason != embedding.REASONS.OK) return null;
			else return response.embedding;
		}
    let vectordb; try { vectordb = await exports.getVectorDBForIDAndOrg(id, org, embeddingsGenerator) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectorDB_ID} for ID ${id} and org ${org}. Unable to continue.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const metadata = {cmspath: await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn), id, 
        date_created: Date.now(), fullpath: pathIn}; metadata[NEURANET_CONSTANTS.NEURANET_DOCID] = _getDocID(pathIn);

    const _getExtractedTextStream = _ => _extractTextViaPluginsUsingStreams(
        isxbin?downloadfile.getReadStream(pathIn):fs.createReadStream(pathIn), aiModelObjectForEmbeddings, pathIn);

    // ingest into the TF.IDF DB
    const tfidfDB = await exports.getTFIDFDBForIDAndOrg(id, org, lang); 
    try {tfidfDB.create(await _readFullFile(await _getExtractedTextStream()).toString("utf8"), metadata);}
    catch (err) {LOG.error(`TF.IDF ingestion failed for path ${pathIn} for ID ${id} and org ${org} with error ${err}.`); }

    // ingest into the vector DB
	let ingestedVectors; try { 
        ingestedVectors = await vectordb.ingeststream(metadata, await _getExtractedTextStream(), 
            aiModelObjectForEmbeddings.encoding, aiModelObjectForEmbeddings.chunk_size, 
            aiModelObjectForEmbeddings.split_separators, aiModelObjectForEmbeddings.overlap);
    } catch (err) { 
        tfidfDB.delete(metadata);   // delete the file from tf.idf DB too to keep them in sync
        LOG.error(`Vector ingestion failed for path ${pathIn} for ID ${id} and org ${org} with error ${err}.`); 
    }

	if (!ingestedVectors) {
		LOG.error(`AI library error indexing document for path ${pathIn} and ID ${id} and org ${org} for vector DB ${vectordb}.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
        LOG.info(`Vector DB ingestion of file ${pathIn} for ID ${id} and org ${org} succeeded.`);
        return {vectors: ingestedVectors, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
    }
}

async function _uningestfile(pathIn, id, org, lang) {
    let vectordb; try { vectordb = await exports.getVectorDBForIDAndOrg(id, org) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    // delete from the TF.IDF DB
    const docID = _getDocID(pathIn), tfidfDB = await exports.getTFIDFDBForIDAndOrg(id, org, lang), 
        docsFound = tfidfDB.query(null, null, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID), 
        metadata = docsFound.length > 0 ? docsFound[0].metadata : null;
    if (!metadata) {
        LOG.error(`Document to uningest at path ${path} for ID ${id} and org ${org} not found in the TF.IDF DB. Dropping the request.`);
        return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
    } else tfidfDB.delete(metadata);
    
    // delete from the Vector DB
    const queryResults = await vectordb.query(undefined, -1, undefined, 
        metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID, true), vectorsDropped = []; 
    if (queryResults) for (const result of queryResults) {
        try {await vectordb.delete(result.vector);} catch (err) {
            LOG.error(`Error dropping vector for file ${pathIn} for ID ${id} and org ${org} failed. Some vectors were dropped. Database needs recovery for this file.`);
            LOG.debug(`The vector which failed was ${result.vector}.`);
            return {vectors: vectorsDropped, reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
        }
        vectorsDropped.push(result.vector); 
    } else {
        LOG.error(`Queyring vector DB for file ${pathIn} for ID ${id} and org ${org} failed.`);
        return {vectors: vectorsDropped, reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    LOG.info(`Vector DB uningestion of file ${pathIn} for ID ${id} and org ${org} succeeded.`);
    return {vectors: vectorsDropped, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

async function _renamefile(from, to, id, org, lang) {
    // update TF.IDF DB 
    const docID = _getDocID(pathIn), tfidfDB = await exports.getTFIDFDBForIDAndOrg(id, org, lang), 
        docsFound = tfidfDB.query(null, null, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID), 
        metadata = docsFound.length > 0 ? docsFound[0].metadata : null, 
        newmetadata = {...metadata, cmspath: cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, path), fullpath: to}; 
    newmetadata[NEURANET_CONSTANTS.NEURANET_DOCID] = _getDocID(to);
    if (!metadata) {
        LOG.error(`Document to rename at path ${path} for ID ${id} and org ${org} not found in the TF.IDF DB. Dropping the request.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    } else tfidfDB.update(metadata, newmetadata);

    // update vector DB
    let vectordb; try { vectordb = await exports.getVectorDBForIDAndOrg(id, org); } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const queryResults = await vectordb.query(undefined, -1, undefined, 
        metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID, true), vectorsRenamed = []; 
    if (queryResults) for (const result of queryResults) {
        if (!vectordb.update(result.vector, newmetadata)) {
            LOG.error(`Renaming the vector file paths failed from path ${from} to path ${to} for ID ${id} and org ${org}.`);
            return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
        } else vectorsRenamed.push(result.vector); 
    } else {
        LOG.error(`Queyring vector DB for file ${from} for ID ${id} and org ${org} failed.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    LOG.info(`Rename of file from ${from} to ${to} for ID ${id} and org ${org} succeeded.`)
    return {vectors: vectorsRenamed, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

exports.getVectorDBForIDAndOrg = async function(id, org, embeddingsGenerator) {
    const vectordb = await aivectordb.get_vectordb(`${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(id, org)}/vectordb`, 
        embeddingsGenerator);
    return vectordb;
}

exports.getTFIDFDBForIDAndOrg = async function(id, org, lang="en") {
    const tfidfdb = await aitfidfdb.get_tfidf_db(`${NEURANET_CONSTANTS.AIDBPATH}/${_getDBID(id, org)}/tfidfdb`, 
        NEURANET_CONSTANTS.NEURANET_DOCID, lang);
    return tfidfdb;
}

const _getDBID = (id, org) => `${(id||DEFAULT_ID).toLowerCase()}_${(org||DEFAULT_ORG).toLowerCase()}`;

async function _extractTextViaPluginsUsingStreams(inputstream, aiModelObject, filepath) {
    for (const textExtractor of aiModelObject.text_extraction_plugins) {
        const extractedTextStream = await (NEURANET_CONSTANTS.getPlugin(textExtractor)).getContentStream(inputstream, filepath);
        if (extractedTextStream) return extractedTextStream;
    } 

    throw new Error(`Unable to process the given file to extract the text.`);
}

function _readFullFile(stream) {
    return new Promise((resolve, reject) => {
        const contents = [];
        stream.on("data", chunk => contents.push(chunk));
        stream.on("close", _ => resolve(Buffer.concat(contents)));
        stream.on("error", err => reject(err));
    });
}

const _getDocID = pathIn => crypto.createHash("md5").update(path.resolve(pathIn)).digest("hex");