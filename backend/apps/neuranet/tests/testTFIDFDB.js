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
    const filesToIngest = argv[1].split(",");

    const _testFailed = err => {const error=`Error TF.IDF testing failed.${err?" Error was "+err:""}\n`; LOG.error(error); LOG.console(error);}
    try{
        let createdMetadata; for (const [i,fileToIngest] of filesToIngest.entries()) {
            createdMetadata = await _testIngestion(path.resolve(fileToIngest), i+1);  // test ingestion
            if (!createdMetadata) {_testFailed("Ingestion failed for file "+fileToIngest); return false;}
        }
    
        const queryResult = await _testQuery(argv[2]);  // test query
        if (!queryResult) {_testFailed("Query failed."); return false;}

        const newMetadata = {...createdMetadata, update_test: true};
        const updatedMetadata = await _testUpdate(createdMetadata, newMetadata);  // test query
        if ((!updatedMetadata) || (!updatedMetadata.update_test)) {_testFailed("Update failed."); return false;}
    } catch (err) {_testFailed(err); return false;}

    await (await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG, "en")).flush();
}

async function _testIngestion(pathIn, docindex) {
    LOG.console(`Test case for TF.IDF ingestion called to ingest file ${pathIn}.\n`);

    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG, "en");  
    const metadata = {id: TEST_ID, org: TEST_ORG, fullpath: pathIn, neuranet_docid: "testdoc"+docindex};  
    try {await tfidfDB.create(await fspromises.readFile(pathIn, "utf8"), metadata); return metadata;}
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

async function _testUpdate(metadataOld, metadataNew) {
    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG, "en");  
    return tfidfDB.update(metadataOld, metadataNew);
}

async function _getTFIDFDBForIDAndOrg(id, org, lang="en") {
    const tfidfDB_ID = `${id}_${org}`, 
        tfidfdb = await aitfidfdb.get_tfidf_db(`${__dirname}/tfidf_db/${tfidfDB_ID}`, "neuranet_docid", lang);
    return tfidfdb;
}