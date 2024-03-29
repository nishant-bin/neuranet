/**
 * Tests overall AI search using AI DBs and algorithms inside them.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const llmflow = require(`${NEURANET_CONSTANTS.APIDIR}/llmflow.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks", TEST_AIAPPID = "tkmaiapp";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aisearch")) {
        LOG.console(`Skipping TF.IDF DB test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing search query.\n"); return;} 
    const query = argv[1].trim();

    const _testFailed = err => {const error=`Error AI search testing failed.${err?" Error was "+err:""}\n`; LOG.error(error); LOG.console(error);}
    try{
        const jsonReq = {id: TEST_ID, org: TEST_ORG, aiappid: TEST_AIAPPID, question: query};
        const queryResult = await llmflow.doService(jsonReq);
        if (((!queryResult) || (!queryResult.result)) && (queryResult?.reason != "noknowledge")) {
            _testFailed("Search failed."); return false; }
        const output = JSON.stringify(queryResult, null, 2); 
        LOG.info(output); LOG.console(output);
        return true;
    } catch (err) {
        _testFailed(err.stack?err.stack:err); return false;
    }
}