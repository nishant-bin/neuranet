/**
 * Indexes the given document as a pre-gen flow (GARAGe) 
 * approach.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const indexdoc = require(`${NEURANET_CONSTANTS.APIDIR}/indexdoc.js`);

/** @return We can handle all files, so always returns true */
exports.canHandle = _ => true; // we can handle all files

/**
 * Will ingest the given file and generate the corresponding pregen (GARAGe) files for it.
 * @param {bject} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.ingest = async function(fileindexer) {
    const pregenSteps = await _getPregenStepsAIApp(fileindexer);
    for (const pregenStep of pregenSteps) {
        const pregenResult = await pregenStep.generate(fileindexer);
        if (pregenResult.result) {
            const indexResult = await fileindexer.addFile(pregenResult.contentBufferOrReadStream(), pregenStep.cmspath, pregenResult.lang, 
                pregenStep.comment, false, false);
            if (!indexResult) {LOG.error(`Pregen failed at step ${pregenStep.label} in add generated file.`); return false;} 
        } else {LOG.error(`Pregen failed at step ${pregenStep.label} in generate.`); return false;}
    }
    const result = await fileindexer.addFile(null, fileindexer.cmspath, fileindexer.lang, null, false, true); 
    await fileindexer.end(); if (!result.result) LOG.error(`Pregen failed at adding original file (AI DB ingestion failure).`);
    return result?result.result:false;
}

/**
 * Will uningest the given file and uningest the corresponding pregen (GARAGe) files for it.
 * @param {bject} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.uningest = async function(fileindexer) {
    const pregenSteps = await _getPregenStepsAIApp(fileindexer); let finalResult = true;
    for (const pregenStep of pregenSteps) {
        const stepIndexerResult = await fileindexer.removeFile(pregenStep.cmspath, false, false);
        if (!stepIndexerResult.result) {LOG.error(`Pregen removal failed at step ${pregenStep.label} in remove generated file.`); 
            finalResult = false;}
    }
    
    const rootIndexerResult = await fileindexer.removeFile(fileindexer.cmspath, false, true); await fileindexer.end();
    if (!rootIndexerResult.result) LOG.error(`Pregen failed at removing original file (AI DB uningestion failure).`);
    return rootIndexerResult.result && finalResult;
}

/**
 * Will rename the given file and rename the corresponding pregen (GARAGe) files for it.
 * @param {bject} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.rename = async function(fileindexer) {
    const pregenSteps = await _getPregenStepsAIApp(fileindexer); let finalResult = true;
    for (const pregenStep of pregenSteps) {
        const stepIndexerResult = await fileindexer.renameFile(pregenStep.cmspath, pregenStep.cmspathTo, false, false);
        if (!stepIndexerResult.result) {
            LOG.error(`Pregen rename failed at step ${pregenStep.label} in rename generated file.`); finalResult = false;}
        }

    const rootIndexerResult = await fileindexer.renameFile(fileindexer.cmspath, fileindexer.cmspathTo, false, true); 
    await fileindexer.end(); if (!rootIndexerResult.result) LOG.error(`Pregen failed at renaming original file (AI DB rename failure).`);
    return rootIndexerResult.result && finalResult;
}

async function _getPregenStepsAIApp(fileindexer) {
    const pregenStepObjects = await aiapp.getPregenObject(fileindexer.id, fileindexer.org, fileindexer.aiappid);
    const pregenFunctions = []; for (const pregenStepObject of pregenStepObjects) {
        const cmspath = `${path.dirname(fileindexer.cmspath)}/${indexdoc.DYNAMIC_FILES_FOLDER}/${pregenStepObject.pathid}_${path.basename(fileindexer.cmspath)}`,
            comment = `${pregenStepObject.label}: ${path.basename(fileindexer.cmspath)}`, 
            cmspathTo = fileindexer.cmspathTo ? `${path.dirname(fileindexer.cmspathTo)}/${indexdoc.DYNAMIC_FILES_FOLDER}/${pregenStepObject.pathid}_${path.basename(fileindexer.cmspathTo)}` : undefined;
        pregenFunctions.push({
            generate: async fileindexer => (await aiapp.getCommandModule(fileindexer.id, fileindexer.org, 
                fileindexer.aiappid, pregenStepObject.command)).generate(fileindexer, pregenStepObject),
            label: pregenStepObject.label,
            cmspath, comment, cmspathTo
        });
    }
        
    return pregenFunctions;
}
