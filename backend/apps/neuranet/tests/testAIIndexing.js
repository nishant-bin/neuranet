/**
 * Tests the vector and TF.IDF DB ingestions and algorithms within them.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const fspromises = require("fs").promises;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const indexdoc = require(`${NEURANET_CONSTANTS.APIDIR}/indexdoc.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks", TEST_APP = "tkmaiapp";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aiindex")) {
        LOG.console(`Skipping AI DB index test case, not called.\n`)
        return;
    }
    if (!argv[1]) {
        LOG.console("Missing test file/s path/s.\n");
        return;
    } 
    const filesToTest = argv.slice(1);

    LOG.console(`Test case for AI DB indexing called to index the files ${filesToTest.join(", ")}.\n`);

    let finalResult = true;
    for (const fileToParse of filesToTest) {
        const base64FileData = (await fspromises.readFile(fileToParse)).toString("base64");
        const jsonReq = {filename: path.basename(fileToParse), 
            data: base64FileData,
            id: TEST_ID, org: TEST_ORG, encoding: "base64", __forceDBFlush: true,
            aiappid: TEST_APP}
        const result = await indexdoc.doService(jsonReq);

        if (result?.result) {
            const successMsg = `Test indexing of ${fileToParse} succeeded.\n`;
            LOG.info(successMsg); LOG.console(successMsg);
        } else {
            finalResult = false; const errorMsg = `Test indexing of ${fileToParse} failed.\n`;
            LOG.error(errorMsg); LOG.console(errorMsg);
        }
    }

    setInterval(_=>{}, 1000);
    return finalResult;
}