/**
 * Tests the vector DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const csvparser = require("papaparse");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);
const aivectordb_test_path = `${__dirname}/vector_db/test@tekmonks.com_Tekmonks`;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "vectoringest")) {
        LOG.console(`Skipping vector DB ingestion test case, not called.\n`)
        return;
    }
    if (!argv[1]) {
        LOG.console("Missing test file path.\n");
        return;
    } 

    LOG.console(`Test case for VectorDB ingestion called to ingest file ${argv[1]}.\n`);

    const vectorDB = await aivectordb.get_vectordb(aivectordb_test_path, undefined, false, false);
    const fileToParse = path.resolve(argv[1]); 
    await _ingestCVSFile(vectorDB, fileToParse);
}

function _ingestCVSFile(vectorDB, fileToParse) {
    const _getFileReadStream = path => path.toLowerCase().endsWith(".gz") ?
        fs.createReadStream(fileToParse).pipe(zlib.createGunzip()) : fs.createReadStream(fileToParse);

    let numRecordsProcessed = 0, numRecordsIngested = 0, waiting_ingestions = 0; 
    return new Promise(resolve => csvparser.parse(_getFileReadStream(fileToParse), {
        step: async function(results, _parser) { 
            waiting_ingestions++;
            const csvLine = results.data;

            let vectorThisResult; if (csvLine.combined_info_search) 
                try {vectorThisResult = JSON.parse(csvLine.combined_info_search)} catch (err) {};
            if (vectorThisResult && csvLine.overview && csvLine.id && (await vectorDB.create(vectorThisResult, 
                    {link: csvLine.homepage, title: csvLine.title, neuranet_docid: csvLine.id}, csvLine.overview)) == vectorThisResult) {
                const message = `${++numRecordsProcessed} --- ${csvLine.title} - Ingested.`; numRecordsIngested++;
                LOG.console(`${message}\n`); LOG.info(message)
            } else {
                const message = `${++numRecordsProcessed} --- ${csvLine.title} - Not Ingested As ${vectorThisResult?"Overview or ID missing":"Vector Parse Failed"}.`;
                LOG.console(`${message}\n`); LOG.error(message);
            }
            waiting_ingestions--;
        },
        header: true,
        dynamicTyping: true,
        complete: _ => {
            const completionTimer = setInterval(async _=> {if (waiting_ingestions == 0) {
                clearInterval(completionTimer);
                await vectorDB.flush_db(); 
                const message = `Completed successfully ${numRecordsProcessed} records. Total ingested ${numRecordsIngested}. Total errors ${numRecordsProcessed - numRecordsIngested}.`;
                LOG.info(message); LOG.console(`${message}\n`); 
                resolve();
            }}, 100);
        },
        error: error => {LOG.error(error); LOG.console("Error: "+error+".\n"); resolve();}
    }));
}