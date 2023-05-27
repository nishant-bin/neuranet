/**
 * Tests the vector DB file based ingestion (using streams as well).
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const testuser_org = "Tekmonks";
const testuser_id = "vectordbtest@tekmonks.com";
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "driveingest")) {
        LOG.console(`Skipping vector DB drive based ingestion test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing test file path.\n"); return;} 
    const pathToFile = path.resolve(argv[1]);

    LOG.console(`Test case for VectorDB drive ingestion called to ingest file ${pathToFile}.\n`);

    const fileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && message.result) resolve(true);
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && (!message.result)) resolve(false);
    }));
    blackboard.publish(XBIN_CONSTANTS.XBINEVENT, {type: XBIN_CONSTANTS.EVENTS.FILE_CREATED, path: pathToFile, 
        ip: utils.getLocalIPs()[0], id: testuser_id, org: testuser_org, return_vectors: false});
    const result = await fileProcessedPromise, outputMessage = `Test ${result?"succeeded":"failed"}.`;
    LOG.info(outputMessage); LOG.console(outputMessage+"\n");
}