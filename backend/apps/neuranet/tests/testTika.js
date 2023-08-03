/**
 * Tests the Apache Tika based text extractor.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const tika = require(`${NEURANET_CONSTANTS.PLUGINSDIR}/tika/tika.js`);

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "extracttext")) {
        LOG.console(`Skipping extract text test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing extraction file's path.\n"); return;} 
    const pathToFile = path.resolve(argv[1]);

    const forceTika = (argv[2]?.toLowerCase() == true);

    try { await tika.initAsync(); } catch (err) { LOG.error(`Can't initialize Tika. Error is ${err}.`); return false; }
    const result = await tika.getContent(pathToFile, forceTika);  // test text extraction using the Tika plugin
    if (!result) return false;

    const outputText = result.toString("utf8");
    const outputMsg = `Extracted text follows\n\n\n--------\n${outputText}\n--------\n\n\n`; LOG.info(outputMsg); LOG.console(outputMsg);
    return true;
}