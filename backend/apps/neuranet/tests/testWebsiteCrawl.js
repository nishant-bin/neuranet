/**
 * Tests the vector DB file based ingestion (using streams as well).
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const testuser_org = "Tekmonks";
const testuser_id = "websitecrawltest@tekmonks.com";
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "webcrawl")) {
        log(`Skipping website crawl ingestion test case, not called.`);
        return;
    }
    if (!argv[1]) {log("Missing test file path."); return;} 
    const pathToFile = path.resolve(argv[1]);

    let result = await _testIngestion(pathToFile);  // test ingestion
    if (!result) return false;
    
    result = await _testUningestion(pathToFile);    // test uningestion, also cleans it all up in the DB
    
    return result;
}

async function _testIngestion(path) {
    log(`Test case for website crawl to ingest file ${path}.`);

    const fileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && message.result) resolve(true);
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && (!message.result)) resolve(false);
    }));
    blackboard.publish(XBIN_CONSTANTS.XBINEVENT, {type: XBIN_CONSTANTS.EVENTS.FILE_CREATED, path, 
        ip: utils.getLocalIPs()[0], id: testuser_id, org: testuser_org});
    const result = await fileProcessedPromise, outputMessage = `Test for ingestion ${result?"succeeded":"failed"}.`;
    log(outputMessage);
    return result;
}

async function _testUningestion(path) {
    log(`Test case for website crawl uningestion called to uningest file ${path}.`);

    const fileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && message.result) resolve(true);
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && (!message.result)) resolve(false);
    }));
    blackboard.publish(XBIN_CONSTANTS.XBINEVENT, {type: XBIN_CONSTANTS.EVENTS.FILE_DELETED, path, 
        ip: utils.getLocalIPs()[0], id: testuser_id, org: testuser_org});
    const result = await fileProcessedPromise, outputMessage = `Test for uningestion ${result?"succeeded":"failed"}.`;
    log(outputMessage); 
    return result;
}

const log = message => {LOG.info(`[Webcrawl Test] ${message}`); LOG.console(`[Webcrawl Test] ${message}\n`);}