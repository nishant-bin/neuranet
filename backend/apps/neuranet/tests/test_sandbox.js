/**
 * Sandbox tester.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const fs = require("fs");

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "sandbox")) {
        LOG.console(`Skipping extract text test case, not called.\n`)
        return;
    }

    await _copyFileToWorkingArea(fs.createReadStream(argv[1]), argv[2]);
}

function _copyFileToWorkingArea(inputstream, workingareaPath) {
    return new Promise((resolve, reject) => {
        const fileoutstreamTemp = fs.createWriteStream(workingareaPath);
        inputstream.on("error", err => reject(err));
        fileoutstreamTemp.on("error", err => reject(err));
        fileoutstreamTemp.on("close", _ => resolve());
        inputstream.pipe(fileoutstreamTemp);
    });
}