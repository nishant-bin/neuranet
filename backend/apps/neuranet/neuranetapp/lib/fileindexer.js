/**
 * Will index files including XBin documents in and out of 
 * the AI databases.
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
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const uploadfile = require(`${XBIN_CONSTANTS.API_DIR}/uploadfile.js`);
const neuranetutils = require(`${NEURANET_CONSTANTS.LIBDIR}/utils.js`);
const downloadfile = require(`${XBIN_CONSTANTS.API_DIR}/downloadfile.js`);

exports.init = _ => blackboard.subscribe(XBIN_CONSTANTS.XBINEVENT, message => _handleFileEvent(message));

async function _handleFileEvent(message) {
    const awaitPromisePublishFileEvent = async (promise, path, type, id, org) => {  // this is mostly to inform listeners about file being processed events
        // we have started processing a file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, { type: NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSING, 
            result: true, subtype: type, id, org, path, 
                cmspath: await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, path) });
        const result = await promise;   // wait for it to complete
        // we have finished processing this file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED, 
            path, result: result?result.result:false, subtype: type, id, org, 
            cmspath: await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, path)});
    }

    if (message.type == XBIN_CONSTANTS.EVENTS.FILE_CREATED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.isxbin, message.lang), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.INGESTED, 
            message.id, message.org);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_DELETED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_uningestfile(path.resolve(message.path), message.id, message.org, message.lang), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.UNINGESTED,
            message.id, message.org);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_RENAMED && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_renamefile(path.resolve(message.from), path.resolve(message.to), message.id, 
            message.org, message.lang), message.to, 
            NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.RENAMED, message.id, message.org);
    else if (message.type == XBIN_CONSTANTS.EVENTS.FILE_MODIFIED && (!message.isDirectory)) {
        await _uningestfile(path.resolve(message.path), message.id, message.org, message.lang);
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.isxbin, message.lang), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.MODIFIED,
            message.id, message.org);
    }
}

async function _ingestfile(pathIn, id, org, isxbin, lang) {
    const indexer = _getFileIndexer(pathIn, isxbin, id, org), filePlugin = await _searchForFilePlugin(indexer);
    if (filePlugin) return {result: filePlugin.ingest(indexer)};
    else return aidbfs.ingestfile(pathIn, id, org, lang, isxbin?_=>downloadfile.getReadStream(pathIn):undefined);
}

async function _uningestfile(pathIn, id, org, lang) {
    const indexer = _getFileIndexer(pathIn, isxbin, id, org), filePlugin = await _searchForFilePlugin(indexer);
    if (filePlugin) return {result: filePlugin.uningest(indexer)};
    else return aidbfs.uningestfile(pathIn, id, org, lang);
}

async function _renamefile(from, to, id, org, lang) {
    const indexer = _getFileIndexer(pathIn, isxbin, id, org), filePlugin = await _searchForFilePlugin(indexer);
    if (filePlugin) return {result: filePlugin.renamefile(indexer)};
    else return aidbfs.renamefile(from, to, id, org, lang);
}

async function _searchForFilePlugin(fileindexerForFile) {
    const aiModelObject = await aidbfs.getAIModelForFiles();

    for (const file_plugin of aiModelObject.file_handling_plugins) {
        const pluginThis = NEURANET_CONSTANTS.getPlugin(file_plugin);
        if (await pluginThis.canHandle(fileindexerForFile)) return pluginThis;
    }

    return false;
}

function _getFileIndexer(pathIn, isxbin, id, org) {
    return {
        filepath: pathIn, id: id, org: org,
        getContents: _ => neuranetutils.readFullFile(isxbin?downloadfile.getReadStream(pathIn):fs.createReadStream(pathIn)),
        getReadstream: _ => isxbin?downloadfile.getReadStream(pathIn):fs.createReadStream(pathIn),
        addFile: (bufferOrStream, cmsPath, comment) => isxbin ? 
            uploadfile.uploadFile(id, org, bufferOrStream, cmsPath, comment) : 
            (async _=>{
                try {
                    await fs.promises.writeFile(cmsPath, Buffer.isBuffer(bufferOrStream) ? bufferOrStream : 
                        neuranetutils.readFullFile(bufferOrStream)); 
                    return CONSTANTS.TRUE_RESULT;
                } catch (err) {
                    LOG.error(`Error writing file ${cmsPath} for ID ${id} and org ${org} due to ${err}.`);
                    return CONSTANTS.FALSE_RESULT;
                }
            })()
    }
}