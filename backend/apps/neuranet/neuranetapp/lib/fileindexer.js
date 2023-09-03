/**
 * Will index files including XBin documents in and out of the AI databases.
 * This should be the only class used for ingestion, except direct file operations
 * to XBin via XBin REST or JS APIs.
 * 
 * Bridge between drive documents including XBin and Neuranet knowledgebases.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See enclosed LICENSE file.
 */

const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const fs = require("fs");
const path = require("path");
const mustache = require("mustache");
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`)
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const uploadfile = require(`${XBIN_CONSTANTS.API_DIR}/uploadfile.js`);
const deletefile = require(`${XBIN_CONSTANTS.API_DIR}/deleteFile.js`);
const downloadfile = require(`${XBIN_CONSTANTS.API_DIR}/downloadfile.js`);
const neuranetutils = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranetutils.js`);

let conf;
const DEFAULT_MINIMIMUM_SUCCESS_PERCENT = 0.5;

exports.initSync = _ => {
    blackboard.subscribe(XBIN_CONSTANTS.XBINEVENT, message => _handleFileEvent(message));
    blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => _handleFileEvent(message));
    conf = require(`${NEURANET_CONSTANTS.CONFDIR}/fileindexer.json`); 
    confRendered = mustache.render(JSON.stringify(conf), {APPROOT: NEURANET_CONSTANTS.APPROOT.split(path.sep).join(path.posix.sep)}); 
    conf = JSON.parse(confRendered);
    _initPluginsSync(); 
}

async function _handleFileEvent(message) {
    const awaitPromisePublishFileEvent = async (promise, path, type, id, org) => {  // this is mostly to inform listeners about file being processed events
        // we have started processing a file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, { type: NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSING, 
            result: true, subtype: type, id, org, path, 
                cmspath: await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, path) });
        const result = await promise;   // wait for it to complete
        // we have finished processing this file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED, 
            path, result: result?result.result:false, subtype: type, id, org, 
            cmspath: await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, path)});
    }

    const _isNeuranetFileCreatedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_CREATED ||
        message.type == NEURANET_CONSTANTS.EVENTS.FILE_CREATED,
        _isNeuranetFileDeletedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_DELETED ||
            message.type == NEURANET_CONSTANTS.EVENTS.FILE_DELETED,
        _isNeuranetFileRenamedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_RENAMED ||
            message.type == NEURANET_CONSTANTS.EVENTS.FILE_RENAMED,
        _isNeuranetFileModifiedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_MODIFIED ||
            message.type == NEURANET_CONSTANTS.EVENTS.FILE_MODIFIED;

    if (_isNeuranetFileCreatedEvent(message) && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.isxbin, message.lang), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.INGESTED, message.id, message.org);
    else if (_isNeuranetFileDeletedEvent(message) && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_uningestfile(path.resolve(message.path), message.id, message.org), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.UNINGESTED, message.id, message.org);
    else if (_isNeuranetFileRenamedEvent(message) && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_renamefile(path.resolve(message.from), path.resolve(message.to), message.id, 
            message.org), message.to, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.RENAMED, message.id, 
            message.org);
    else if (_isNeuranetFileModifiedEvent(message) && (!message.isDirectory)) {
        await _uningestfile(path.resolve(message.path), message.id, message.org);
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.isxbin, message.lang), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.MODIFIED, message.id, message.org);
    }
}

async function _ingestfile(pathIn, id, org, isxbin, lang) {
    const cmspath = isxbin ? await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn) : pathIn;
    const indexer = _getFileIndexer(pathIn, isxbin, id, org, cmspath), filePluginResult = await _searchForFilePlugin(indexer);
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.ingest(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else return await indexer.addFile(null, cmspath, lang, null, false, true);
}

async function _uningestfile(pathIn, id, org) {
    const cmspath = isxbin ? await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn) : pathIn;
    const indexer = _getFileIndexer(pathIn, undefined, id, org, cmspath), filePluginResult = await _searchForFilePlugin(indexer);
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.uningest(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else return await indexer.removeFile(cmspath, false, true);
}

async function _renamefile(from, to, id, org) {
    const cmspathFrom = isxbin ? await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, from) : from;
    const cmspathTo = isxbin ? await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, to) : to;
    const indexer = _getFileIndexer(from, isxbin, id, org, cmspathFrom), filePluginResult = await _searchForFilePlugin(indexer);
    indexer.filepathTo = to; indexer.cmspathTo = cmspathTo;
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.rename(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else return await indexer.renameFile(cmspathFrom, cmspathTo, false, true);
}

async function _initPluginsSync() {
    const aiModelObject = await aidbfs.getAIModelForFiles();

    for (const file_plugin of aiModelObject.file_handling_plugins) {
        const pluginThis = NEURANET_CONSTANTS.getPlugin(file_plugin);
        if (pluginThis.initAsync) await pluginThis.initSync();
    }
}

async function _searchForFilePlugin(fileindexerForFile) {
    const aiModelObject = await aidbfs.getAIModelForFiles();

    for (const file_plugin of aiModelObject.file_handling_plugins) {
        const pluginThis = NEURANET_CONSTANTS.getPlugin(file_plugin);
        try {if (await pluginThis.canHandle(fileindexerForFile)) return {plugin: pluginThis, result: true, error: null};}
        catch (err) { LOG.error(`Plugin validation failed for ${file_plugin}. The error was ${err}`);
            return {error: err, result: false}}
    }

    return {error: null, result: false};
}

function _getFileIndexer(pathIn, isxbin, id, org, cmspath) {
    return {
        filepath: pathIn, id: id, org: org, minimum_success_percent: DEFAULT_MINIMIMUM_SUCCESS_PERCENT, cmspath,
        getContents: _ => neuranetutils.readFullFile(isxbin?downloadfile.getReadStream(pathIn):fs.createReadStream(pathIn)),
        getReadstream: _ => isxbin?downloadfile.getReadStream(pathIn):fs.createReadStream(pathIn),
        start: _ => {},
        end: async _ => { try {await aidbfs.rebuild(id, org); await aidbfs.flush(id, org); return true;} catch (err) {
            LOG.error(`Error ending AI databases. The error is ${err}`); return false;} },
        addFile: async (bufferOrStream, cmsPathFile, langFile, comment, runAsNewInstructions, noDiskOperation) => {
            try {
                const fullPath = isxbin ? await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathFile) : 
                    await _getNonCMSDrivePath(cmsPathFile, id, org);
                // write the file to the file system being used whether it is XBin or Neuranet's internal drive
                if (isxbin && (!noDiskOperation)) {
                    if (!(await uploadfile.uploadFile(id, org, bufferOrStream, cmsPathFile, comment, true))?.result)
                        throw new Error(`CMS upload failed for ${cmsPathFile}`);
                } else if (!noDiskOperation) await fs.promises.writeFile(fullPath, Buffer.isBuffer(bufferOrStream) ? 
                    bufferOrStream : neuranetutils.readFullFile(bufferOrStream));    // write to the disk

                // if run as new instructions then publish a message which triggers file indexer to restart the 
                // whole process else ingest it directly into the DB as a regular file. it is a security risk
                // to setup runAsNewInstructions = true e.g. a website can have a .crawl file for Neuranet to
                // crawl bad data, so unless needed this should not be setup to true
                if (runAsNewInstructions) {
                    blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, // ingest it into Neuranet
                        {type: NEURANET_CONSTANTS.EVENTS.FILE_CREATED, path: fullPath, id, org, 
                            ip: serverutils.getLocalIPs()[0]});
                    return CONSTANTS.TRUE_RESULT;
                } else if ((await aidbfs.ingestfile(fullPath, cmsPathFile, id, org, langFile, 
                    isxbin?_=>downloadfile.getReadStream(fullPath):undefined, true))?.result) return CONSTANTS.TRUE_RESULT;
                else return CONSTANTS.FALSE_RESULT;
            } catch (err) {
                LOG.error(`Error writing file ${cmsPathFile} for ID ${id} and org ${org} due to ${err}.`);
                return CONSTANTS.FALSE_RESULT;
            }
        },
        removeFile: async(cmsPathFile, runAsNewInstructions, noDiskOperation) => {
            try {
                const fullPath = isxbin ? await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathFile) : 
                    await _getNonCMSDrivePath(cmsPathFile, id, org);

                // delete the file from the file system being used whether it is XBin or Neuranet's internal drive
                if (isxbin && (!noDiskOperation)) {
                    if (!(await deletefile.deleteFile({xbin_id: id, xbin_org: org}, cmsPathFile, true))?.result)
                        throw new Error(`CMS delete failed for ${cmsPathFile}`);
                } else if (!noDiskOperation) await fs.promises.unlink(fullPath);    // delete from the disk

                if (runAsNewInstructions) {
                    blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, // remove it from the Neuranet
                        {type: NEURANET_CONSTANTS.EVENTS.FILE_DELETED, path: fullPath, id, org, 
                            ip: serverutils.getLocalIPs()[0]});
                    return CONSTANTS.TRUE_RESULT;
                } else if ((await aidbfs.uningestfile(fullPath, id, org)?.result)) return CONSTANTS.TRUE_RESULT;
                else return CONSTANTS.FALSE_RESULT;
            } catch (err) {
                LOG.error(`Error deleting file ${cmsPathFile} for ID ${id} and org ${org} due to ${err}.`);
                return CONSTANTS.FALSE_RESULT;
            }
        },
        renameFile: async(cmsPathFrom, cmsPathTo, runAsNewInstructions, noDiskOperation) => {
            try {
                const fullPathFrom = isxbin ? await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathFrom) : 
                    await _getNonCMSDrivePath(cmsPathFrom, id, org);
                const fullPathTo = isxbin ? await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathTo) : 
                    await _getNonCMSDrivePath(cmsPathTo, id, org);

                // rename the file from the file system being used whether it is XBin or Neuranet's internal drive
                if (isxbin && (!noDiskOperation)) {
                    if (!(await renamefile.renameFile({xbin_id: id, xbin_org: org}, cmsPathFrom, cmsPathTo, true))?.result)
                        throw new Error(`CMS rename failed for ${cmsPathFrom}`);
                } else if (!noDiskOperation) await fs.promises.rename(fullPathFrom, fullPathTo);    // rename on the disk

                if (runAsNewInstructions) {
                    blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, // remove it from the Neuranet
                        {type: NEURANET_CONSTANTS.EVENTS.FILE_RENAMED, from: fullPathFrom, to: fullPathTo, id, org, 
                            ip: serverutils.getLocalIPs()[0]});
                    return CONSTANTS.TRUE_RESULT;
                } else if ((await aidbfs.renamefile(fullPathFrom, fullPathTo, id, org)?.result)) return CONSTANTS.TRUE_RESULT;
                else return CONSTANTS.FALSE_RESULT;
            } catch (err) {
                LOG.error(`Error renaming file ${cmsPathFrom} for ID ${id} and org ${org} due to ${err}.`);
                return CONSTANTS.FALSE_RESULT;
            }
        }
    }
}

async function _getNonCMSDrivePath(cmsPath, id, org) {
    const userRoot = path.resolve(`${conf.noncms_drive}/${org}/${id}`);
    const fullPath = path.resolve(userRoot+"/"+cmsPath), folderFullPath = path.dirname(fullPath);
    try {await fs.promises.stat(folderFullPath); return fullPath;} catch (err) {
        if (err.code == "ENOENT") {try {await fs.promises.mkdir(folderFullPath, {recursive: true}); return fullPath;} 
            catch (err) {throw err}} else throw err;
    }
}