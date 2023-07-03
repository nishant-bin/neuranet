/**
 * Tests the TF.IDF DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const fspromises = require("fs").promises;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aitfidfdb = require(`${NEURANET_CONSTANTS.LIBDIR}/aitfidfdb.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "tfidftest")) {
        LOG.console(`Skipping TF.IDF DB test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing test file path.\n"); return;} 
    const pathToFile = path.resolve(argv[1]);

    const _testFailed = err => {const error=`Error TF.IDF testing failed.${err?"Error was "+err:""}\n`; LOG.error(error); LOG.console(error);}
    try{
        let result = await _testIngestion(pathToFile);  // test ingestion
        if (!result) {_testFailed(); return false;}
    } catch (err) {_testFailed(err); return false;}

    try {
        result = await _testQuery(argv[2]);  // test query
        if (!result) {_testFailed(); return false;}
    } catch (err) {_testFailed(err); return false;}

    await (await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG, "en")).flush();

    /*const tempRename = pathToFile+".rename_test.txt";
    await fspromises.rename(pathToFile, tempRename);
    result = await _testRename(pathToFile, tempRename);
    await fspromises.rename(tempRename, pathToFile);
    if (result) result = await _testRename(tempRename, pathToFile); // get DB back to sync for cleanup later
    if (!result) return false;
    
    result = await _testUningestion(pathToFile);    // test uningestion, also cleans it all up in the DB*/
}

async function _testIngestion(pathIn) {
    LOG.console(`Test case for TF.IDF ingestion called to ingest file ${pathIn}.\n`);

    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG, "en");  
    const metadata = {id: TEST_ID, org: TEST_ORG, fullpath: pathIn};  
    try {await tfidfDB.create(await fspromises.readFile(pathIn, "utf8"), metadata); return true;}
    catch (err) {
        LOG.error(`TF.IDF ingestion failed for path ${pathIn} for ID ${TEST_ID} and org ${TEST_ORG} with error ${err}.`); 
        return false;
    }
}

async function _testQuery(query) {
    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG, "en");  
    const queryResult = tfidfDB.query(query, 3, null, 0.5);
    if (!queryResult) return null;
    const logMsg = `Query result is ${JSON.stringify(queryResult, null, 2)}.\n`; LOG.info(logMsg); LOG.console(logMsg);
    return queryResult;
}

async function _getTFIDFDBForIDAndOrg(id, org, lang="en") {
    const tfidfDB_ID = `${id}_${org}`, 
        tfidfdb = await aitfidfdb.get_tfidf_db(`${__dirname}/tfidf_db/${tfidfDB_ID}`, lang);
    return tfidfdb;
}