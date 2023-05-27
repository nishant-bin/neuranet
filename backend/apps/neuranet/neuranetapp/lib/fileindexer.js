/**
 * Will index documents in and out of vector databases.
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See enclosed LICENSE file.
 */

const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const fs = require("fs");
const path = require("path");
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);

REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, 
	MODEL_DEFAULT = "embedding-openai-ada002";

exports.init = _ => blackboard.subscribe(XBIN_CONSTANTS.XBINEVENT, message => _handleFileEvent(message));

async function _handleFileEvent(message) {
    const awaitPromisePublishFileEvent = async (promise, path, return_vectors) => {
        const result = await promise; 
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED, 
            path, result: result.result, vectors: return_vectors ? result.vectors : undefined});
    }

    if (message.type == XBIN_CONSTANTS.EVENTS.FILE_CREATED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org), message.path, message.return_vectors);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_DELETED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_uningestfile(path.resolve(message.path), message.id, message.org), message.path, message.return_vectors);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_RENAMED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_renamefile(path.resolve(message.from), path.resolve(message.to), message.id, message.org), message.from, message.return_vectors);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_MODIFIED && (!message.isDirectory)) {
        await _uningestfile(path.resolve(message.path), message.id, message.org);
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org), message.path, message.return_vectors);
    }
}

async function _ingestfile(pathIn, id, org) {
    if (!(await quota.checkQuota(id))) {
		LOG.error(`Disallowing the ingest call for the path ${pathIn}, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

    const aiModelToUseForEmbeddings = MODEL_DEFAULT, aiModelObjectForEmbeddings = await aiutils.getAIModel(aiModelToUseForEmbeddings), 
        embeddingsGenerator = async text => {
			const response = await embedding.createEmbeddingVector(id, text, aiModelToUseForEmbeddings); 
			if (response.reason != embedding.REASONS.OK) return null;
			else return response.embedding;
		}
    let vectordb; try { vectordb = await exports.getVectorDBForIDAndOrg(id, org, embeddingsGenerator) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectorDB_ID}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }
    const cmsRoot = await cms.getCMSRoot({xbin_id: id, xbin_org: org}), metadata = {
        cmspath: encodeURI(path.relative(cmsRoot, pathIn).replaceAll("\\", "/")), id, date_created: Date.now(), fullpath: pathIn};
	let ingestedVectors; try {ingestedVectors = await vectordb.ingeststream(metadata, fs.createReadStream(pathIn), 
        aiModelObjectForEmbeddings.encoding, aiModelObjectForEmbeddings.chunk_size, aiModelObjectForEmbeddings.split_separators, 
        aiModelObjectForEmbeddings.overlap);} catch (err) {LOG.error(`Vector ingestion failed for path ${pathIn} with error ${err}.`);}

	if (!ingestedVectors) {
		LOG.error(`AI library error indexing document for path ${pathIn} and ID ${id} for vector DB ${vectordb}.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else return {vectors: ingestedVectors, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

async function _uningestfile(path, id, org) {
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrg(id, org, embeddingsGenerator) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const queryResults = aivectordb.query(undefined, -1, undefined, metadata => metadata.fullpath == path, true);
    const vectorsDropped = []; if (queryResults) for (const result of queryResults) {
        vectorsDropped.push(result.vector); vectordb.delete(result.vector);
    } else {
        LOG.error(`Queyring vector DB for file ${path} for ID ${id} failed.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    return {vectors: vectorsDropped, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

async function _renamefile(from, to, id, org) {
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrg(id, org, embeddingsGenerator) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const queryResults = aivectordb.query(undefined, -1, undefined, metadata => metadata.fullpath == from, true);
    const vectorsRenamed = []; if (queryResults) for (const result of queryResults) {
        const metadata = result.metadata; metadata.link = path.relative(cms.getCMSRoot({xbin_id: id, xbin_org: org}), to); metadata.fullpath = to;
        if (!vectordb.update(result.vector, metadata)) {
            LOG.error(`Renaming the vector file paths failed for path ${to} of ID ${id}.`);
            return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
        } else vectorsRenamed.push(result.vector); 
    } else {
        LOG.error(`Queyring vector DB for file ${path} for ID ${id} failed.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    return {vectors: vectorsRenamed, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

exports.getVectorDBForIDAndOrg = async function(id, org, embeddingsGenerator) {
    const vectorDB_ID = `vectordb_index_${id}_${org}`, 
        vectordb = await aivectordb.get_vectordb(`${NEURANET_CONSTANTS.VECTORDBPATH}/${vectorDB_ID}`, embeddingsGenerator);
    return vectordb;
}