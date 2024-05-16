/**
 * Tests overall AI search using AI DBs and algorithms inside them.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const llmflow = require(`${NEURANET_CONSTANTS.APIDIR}/llmflow.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks", TEST_APP = "tkmaiapp";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aisearch")) {
        LOG.console(`Skipping AI Search test case, not called.\n`)
        return;
    }
    if (!argv[1]) { LOG.console("Missing search query.\n"); return; } 
    const queries = argv.slice(1).map(query =>  query.trim());
    
    LOG.console(`Test case for AI Search called to ask the queries ${JSON.stringify(queries)}.\n`);

    let responseCounts = 0; for (const query of queries) {
        LOG.console(`\nQuery: ${query}\n`);
        try{
            const jsonReq = {id: TEST_ID, org: TEST_ORG, aiappid: TEST_APP, question: query};
            const queryResult = await llmflow.doService(jsonReq);
            if (((!queryResult) || (!queryResult.result))) {
                LOG.console({result:false, err:queryResult.reason||"Search failed."}); }
            else {
                const output = "Results\n"+JSON.stringify(queryResult, null, 2); responseCounts++;
                const logObject = { result:true, response:queryResult.response||queryResult.reason };
                LOG.info(output); LOG.console(`${JSON.stringify(logObject)}\n`);
            }
        } catch (err) { LOG.console({result:false, err:"Search failed."}); }
    }

    LOG.info("Finished Asking All queries."); LOG.console("\nFinished Asking All queries.\n");
    return responseCounts === queries.length;
}