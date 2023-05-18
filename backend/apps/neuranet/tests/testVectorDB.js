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
const aivectordb_test_path = `${__dirname}/vector_db/test`;

exports.runTestsAsync = async function(argv) {
    LOG.console(`Test case for VectorDB called.\n`);
    if (!argv[0]) {
        LOG.console("Missing test file path.\n");
        return;
    }

    const vectorDB = await aivectordb.get_vectordb(aivectordb_test_path);
    const fileToParse = path.resolve(argv[0]), _getFileReadStream = path => path.toLowerCase().endsWith(".gz") ?
        fs.createReadStream(fileToParse).pipe(zlib.createGunzip()) : fs.createReadStream(fileToParse);
    
    let numRecordsProcessed = 0, numRecordsIngested = 0;
    return new Promise(resolve => csvparser.parse(_getFileReadStream(fileToParse), {
        step: function(results, _parser) { 
            const csvLine = results.data;

            let vectorThisResult; if (csvLine.combined_info_search) 
                try {vectorThisResult = JSON.parse(csvLine.combined_info_search)} catch (err) {};
            if (vectorThisResult && csvLine.overview) {
                vectorDB.create(vectorThisResult, {link: csvLine.homepage, title: csvLine.title}, csvLine.overview);
                const message = `${++numRecordsProcessed} --- ${csvLine.title} - Ingested.`; numRecordsIngested++;
                LOG.console(`${message}\n`); LOG.info(message)
            } else {
                const message = `${++numRecordsProcessed} --- ${csvLine.title} - Not Ingested As ${vectorThisResult?"Overview missing":"Vector Parse Failed"}.`;
                LOG.error(`${message}\n`); LOG.info(message)
            }
        },
        header: true,
        dynamicTyping: true,
        complete: _ => {
            const message = `Completed successfully ${numRecordsProcessed} records. Total ingested ${numRecordsIngested}. Total errors ${numRecordsProcessed - numRecordsIngested}.`;
            LOG.info(message); LOG.console(`${message}\n`); resolve();
        },
        error: error => {LOG.error(error); LOG.console("Error: "+error+".\n"); resolve();}
    }));
}
