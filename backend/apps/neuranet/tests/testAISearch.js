/**
 * Tests overall AI search using AI DBs and algorithms inside them.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const search = require(`${NEURANET_CONSTANTS.LIBDIR}/search.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks", SEARCH_MODEL_DEFAULT = "chat-knowledgebase-gpt35-turbo";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aisearch")) {
        LOG.console(`Skipping TF.IDF DB test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing search query.\n"); return;} 
    const query = argv[1].trim();

    const _testFailed = err => {const error=`Error AI search testing failed.${err?" Error was "+err:""}\n`; LOG.error(error); LOG.console(error);}
    try{
        const queryResult = await search.find("docvectorsearch", TEST_ID, TEST_ORG, query, SEARCH_MODEL_DEFAULT);
        if (!queryResult) {_testFailed("Search failed."); return false;}
        const output = JSON.stringify(queryResult, null, 2); 
        LOG.info(output); LOG.console(output);
    } catch (err) {_testFailed(err); return false;}
}