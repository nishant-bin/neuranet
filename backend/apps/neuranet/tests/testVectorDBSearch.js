/**
 * Tests the vector DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);
const aivectordb_test_path = `${__dirname}/vector_db/test`;

const topK = 5, minDistance = 0.5;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "search")) {
        LOG.console(`Skipping vector DB search test case, not called.\n`)
        return;
    }
    if (!argv[1]) {
        LOG.console("Missing query test file path.\n");
        return;
    } 
    const multithreaded = (argv[2]||"").toLowerCase() == "multithreaded" ? true : false;
    const notext = (argv[3]||"").toLowerCase() == "notext" ? true : false;

    LOG.console(`Test case for VectorDB search called with query file ${argv[1]}.\n`);
    const queryFile = require(argv[1]);

    const vectorDB = await aivectordb.get_vectordb(aivectordb_test_path, undefined, multithreaded, false);
    LOG.console(`Searching for ${queryFile.text}, top ${topK} results with a minimum distance of ${minDistance}.\n`);
    const timeStart = Date.now();
    const results = await vectorDB.query(queryFile.vector, topK, minDistance, undefined, notext, multithreaded);
    const timeTaken = Date.now() - timeStart;

    for (const result of results) delete result.vector; // we don't want to show the massive result vectors
    LOG.console(`Results follow\n${JSON.stringify(results, null, 4)}\n`);
    LOG.console(`\nSearch took ${timeTaken} milliseconds.\n`);
}
