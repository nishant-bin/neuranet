/**
 * Will index files including XBin documents in and out of the AI databases.
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
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.INGESTED, 
            message.id, message.org);
    else if (_isNeuranetFileDeletedEvent(message) && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_uningestfile(path.resolve(message.path), message.id, message.org, message.lang), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.UNINGESTED,
            message.id, message.org);
    else if (_isNeuranetFileRenamedEvent(message) && (!message.isDirectory)) 
        awaitPromisePublishFileEvent(_renamefile(path.resolve(message.from), path.resolve(message.to), message.id, 
            message.org, message.lang), message.to, 
            NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.RENAMED, message.id, message.org);
    else if (_isNeuranetFileModifiedEvent(message) && (!message.isDirectory)) {
        await _uningestfile(path.resolve(message.path), message.id, message.org, message.lang);
        awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.isxbin, message.lang), 
            message.path, NEURANET_CONSTANTS.VECTORDB_FILE_PROCESSED_EVENT_TYPES.MODIFIED,
            message.id, message.org);
    }
}

async function _ingestfile(pathIn, id, org, isxbin, lang) {
    const cmspath = isxbin ? await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn) : pathIn;
    const indexer = _getFileIndexer(pathIn, isxbin, id, org, lang, cmspath), filePluginResult = await _searchForFilePlugin(indexer);
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.ingest(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else return await aidbfs.ingestfile(pathIn, id, org, lang, isxbin?_=>downloadfile.getReadStream(pathIn):undefined);
}

async function _uningestfile(pathIn, id, org, lang) {
    const cmspath = isxbin ? await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn) : pathIn;
    const indexer = _getFileIndexer(pathIn, undefined, id, org, lang, cmspath), filePluginResult = await _searchForFilePlugin(indexer);
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.uningest(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else return await aidbfs.uningestfile(pathIn, id, org, lang);
}

async function _renamefile(from, to, id, org, lang) {
    const cmspath = isxbin ? await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn) : pathIn;
    const indexer = _getFileIndexer(pathIn, isxbin, id, org, lang, cmspath), filePluginResult = await _searchForFilePlugin(indexer);
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.rename(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else return await aidbfs.renamefile(from, to, id, org, lang);
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

function _getFileIndexer(pathIn, isxbin, id, org, lang, cmspath) {
    return {
        filepath: pathIn, id: id, org: org, minimum_success_percent: DEFAULT_MINIMIMUM_SUCCESS_PERCENT, cmspath,
        getContents: _ => neuranetutils.readFullFile(isxbin?downloadfile.getReadStream(pathIn):fs.createReadStream(pathIn)),
        getReadstream: _ => isxbin?downloadfile.getReadStream(pathIn):fs.createReadStream(pathIn),
        start: _ => {},
        end: async _ => { try {await aidbfs.rebuild(id, org, lang); await aidbfs.flush(id, org, lang); return true;} catch (err) {
            LOG.error(`Error ending AI databases. The error is ${err}`); return false;} },
        addFile: async (bufferOrStream, cmsPath, comment, runAsNewInstructions) => {
            try {
                const pathToWriteTo = isxbin ? await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPath) : 
                    await _getNonCMSDrivePath(cmsPath, id, org);
                // write the file to the file system being used whether it is XBin or Neuranet's internal drive
                if (isxbin) {
                    if (!(await uploadfile.uploadFile(id, org, bufferOrStream, cmsPath, comment, true))?.result)
                        throw new Error(`CMS upload failed for ${cmsPath}`);
                } else await fs.promises.writeFile(pathToWriteTo, Buffer.isBuffer(bufferOrStream) ? 
                    bufferOrStream : neuranetutils.readFullFile(bufferOrStream));    // write to the disk

                // if run as new instructions then publish a message which triggers file indexer to restart the 
                // whole process else ingest it directly into the DB as a regular file. it is a security risk
                // to setup runAsNewInstructions = true e.g. a website can have a .crawl file for Neuranet to
                // crawl bad data, so unless needed this should not be setup to true
                if (runAsNewInstructions) {
                    blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, // ingest it into Neuranet
                        {type: NEURANET_CONSTANTS.EVENTS.FILE_CREATED, path: pathToWriteTo, id, org, 
                            ip: serverutils.getLocalIPs()[0]});
                    return CONSTANTS.TRUE_RESULT;
                } else if ((await aidbfs.ingestfile(pathToWriteTo, id, org, lang, 
                    isxbin?_=>downloadfile.getReadStream(pathToWriteTo):undefined, true))?.result) return CONSTANTS.TRUE_RESULT;
                else return CONSTANTS.FALSE_RESULT;
            } catch (err) {
                LOG.error(`Error writing file ${cmsPath} for ID ${id} and org ${org} due to ${err}.`);
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