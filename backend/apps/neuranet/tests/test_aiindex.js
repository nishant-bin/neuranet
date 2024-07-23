/**
 * Tests the vector and TF.IDF DB ingestions and algorithms within them.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const fspromises = require("fs").promises;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const indexdoc = require(`${NEURANET_CONSTANTS.APIDIR}/indexdoc.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks", TEST_APP = require(`${__dirname}/conf/testing.json`).aiapp;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aiindex")) {
        LOG.console(`Skipping AI DB index test case, not called.\n`)
        return;
    }

    if (!argv[1]) { LOG.console("Missing test file/s path/s.\n"); return; }

    let async = argv.pop(); if(typeof async!=='boolean') argv.push(async);
    const filesToTest = argv.slice(1).map(path => `${__dirname}/assets/${path}`);

    LOG.console(`Test case for AI DB indexing called to index the files ${filesToTest.join(", ")}.\n`);

    await dblayer.initDBAsync();    // we need DB before anything else happens
    
    let finalResults = 0; 
    const indexFileAPIRequest = async jsonReq => {
        const result = await indexdoc.doService(jsonReq);
        if (result?.result) {
            const successMsg = `Test indexing of ${jsonReq.filename} succeeded.\n`;
            LOG.info(successMsg); LOG.console(successMsg); finalResults++;
        } else {
            const errorMsg = `Test indexing of ${jsonReq.filename} failed.\n`;
            LOG.error(errorMsg); LOG.console(errorMsg);
        }
    };

    const  indexingPromises = [], processFile = async (fileToParse, flush) => {
        const base64FileData = (await fspromises.readFile(fileToParse)).toString("base64");
        const jsonReq = {filename: path.basename(fileToParse), 
            data: base64FileData,
            id: TEST_ID, org: TEST_ORG, encoding: "base64", __forceDBFlush: flush,
            aiappid: TEST_APP}; 
        if(!async) indexingPromises.push(indexFile(jsonReq));
        else indexingPromises.push(await indexFile(jsonReq));
    }
    for (const fileToParse of filesToTest.slice(0, -1)) indexingPromises.push(processFile(fileToParse, false));
    const lastFile = filesToTest[filesToTest.length-1]; indexingPromises.push(processFile(lastFile, true)); // write out the DB to the disk

    if(!async) await Promise.all(indexingPromises);    // wait for all files to finish

    return finalResults === filesToTest.length;
}