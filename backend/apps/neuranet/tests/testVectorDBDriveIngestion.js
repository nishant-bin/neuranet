/**
 * Tests the vector DB file based ingestion (using streams as well).
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const testuser_org = "Tekmonks";
const fspromises = require("fs").promises;
const testuser_id = "vectordbtest@tekmonks.com";
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "driveingest")) {
        LOG.console(`Skipping vector DB drive based ingestion test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing test file path.\n"); return;} 
    const pathToFile = path.resolve(argv[1]);

    let result = await _testIngestion(pathToFile);  // test ingestion
    if (!result) return false;

    const tempRename = pathToFile+".rename_test.txt";
    await fspromises.rename(pathToFile, tempRename);
    result = await _testRename(pathToFile, tempRename);
    await fspromises.rename(tempRename, pathToFile);
    if (result) result = await _testRename(tempRename, pathToFile); // get DB back to sync for cleanup later
    if (!result) return false;
    
    result = await _testUningestion(pathToFile);    // test uningestion, also cleans it all up in the DB
    
    return result;
}

async function _testIngestion(path) {
    LOG.console(`Test case for VectorDB drive ingestion called to ingest file ${path}.\n`);

    const fileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && message.result) resolve(true);
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && (!message.result)) resolve(false);
    }));
    blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.FILE_CREATED, path, 
        ip: utils.getLocalIPs()[0], id: testuser_id, org: testuser_org, return_vectors: true});
    const result = await fileProcessedPromise, outputMessage = `Test for ingestion ${result?"succeeded":"failed"}.`;
    LOG.info(outputMessage); LOG.console(outputMessage+"\n");
    return result;
}

async function _testUningestion(path) {
    LOG.console(`Test case for VectorDB drive uningestion called to uningest file ${path}.\n`);

    const fileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && message.result) resolve(true);
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && (!message.result)) resolve(false);
    }));
    blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.FILE_DELETED, path, 
        ip: utils.getLocalIPs()[0], id: testuser_id, org: testuser_org, return_vectors: true});
    const result = await fileProcessedPromise, outputMessage = `Test for uningestion ${result?"succeeded":"failed"}.`;
    LOG.info(outputMessage); LOG.console(outputMessage+"\n");
    return result;
}

async function _testRename(path, newpath) {
    LOG.console(`Test case for VectorDB drive rename called to rename file ${path} to new name ${newpath}.\n`);

    const fileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && message.result) resolve(true);
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && (!message.result)) resolve(false);
    }));
    blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.FILE_RENAMED, from: path, to: newpath,
        ip: utils.getLocalIPs()[0], id: testuser_id, org: testuser_org, return_vectors: true});
    const result = await fileProcessedPromise, outputMessage = `Test for rename ${result?"succeeded":"failed"}.`;
    LOG.info(outputMessage); LOG.console(outputMessage+"\n");
    return result;
}