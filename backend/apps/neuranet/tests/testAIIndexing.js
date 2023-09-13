/**
 * Tests the vector DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const fspromises = require("fs").promises;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const indexdoc = require(`${NEURANET_CONSTANTS.APIDIR}/indexdoc.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aiindex")) {
        LOG.console(`Skipping AI DB index test case, not called.\n`)
        return;
    }
    if (!argv[1]) {
        LOG.console("Missing test file path.\n");
        return;
    } 

    LOG.console(`Test case for AI DB indexing called to index the file ${argv[1]}.\n`);

    const fileToParse = path.resolve(argv[1]); 
    const jsonReq = {filename: path.basename(fileToParse), 
        data: (await fspromises.readFile(fileToParse)).toString("base64"),
        id: TEST_ID, org: TEST_ORG, encoding: "base64", __forceDBFlush: true}
    const result = await indexdoc.doService(jsonReq);

    if (result?.result) {
        LOG.info(`Test indexing of ${fileToParse} succeeded.`); LOG.console(`Test indexing of ${fileToParse} succeeded.\n`);
    } else {
        LOG.error(`Test indexing of ${fileToParse} failed.`); LOG.console(`Test indexing of ${fileToParse} failed.\n`);
    }

    setInterval(_=>{}, 100);
}