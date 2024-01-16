/**
 * Indexes the given document as a pre-gen flow (GARAGe) 
 * approach.
 * 
 * All pregen plugins must contain this function
 * async function generate(fileindexer, generatorDefinition)
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const conf = require(`${__dirname}/pregenindexer.json`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

/** @return true if we can handle else false */
exports.canHandle = async fileindexer => {
    const pregenStepObjects = await aiapp.getPregenObject(fileindexer.id, fileindexer.org, fileindexer.aiappid);
    if ((!pregenStepObjects) || (!pregenStepObjects.length)) return false;  // nothing to pregen for this app

    if (conf.skip_extensions.includes(path.extname(fileindexer.filepath).toLowerCase())) return false; 

    return true;    // if told to pregen, then we can handle all files
}

/**
 * Will ingest the given file and generate the corresponding pregen (GARAGe) files for it.
 * @param {object} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.ingest = async function(fileindexer) {
    const pregenSteps = await _getPregenStepsAIApp(fileindexer); let finalResult = true;
    for (const pregenStep of pregenSteps) {
        if (!await _condition_to_run_met(pregenStep)) continue;    // run only if condition is satisfied
        const pregenResult = await pregenStep.generate(fileindexer);
        if (pregenResult.result) {
            const indexResult = await fileindexer.addFile(pregenResult.contentBufferOrReadStream(), 
                pregenStep.cmspath, pregenResult.lang, pregenStep.comment, false, false);
            if (!indexResult) {LOG.error(`Pregen failed at step ${pregenStep.label} in add generated file.`); finalResult = false;} 
        } else {LOG.error(`Pregen failed at step ${pregenStep.label} in generate.`); finalResult = false;}
    }
    const rootIndexerResult = await fileindexer.addFile(null, fileindexer.cmspath, fileindexer.lang, null, false, true); 
    await fileindexer.end(); if (!rootIndexerResult.result) LOG.error(`Pregen failed at adding original file (AI DB ingestion failure).`);
    return rootIndexerResult.result && finalResult;
}

/**
 * Will uningest the given file and uningest the corresponding pregen (GARAGe) files for it.
 * @param {bject} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.uningest = async function(fileindexer) {
    const pregenSteps = await _getPregenStepsAIApp(fileindexer); let finalResult = true;
    for (const pregenStep of pregenSteps) {
        if (!await _condition_to_run_met(pregenStep)) continue;    // run only if condition is satisfied
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
        if (!await _condition_to_run_met(pregenStep)) continue;    // run only if condition is satisfied
        const stepIndexerResult = await fileindexer.renameFile(pregenStep.cmspath, pregenStep.cmspathTo, 
            pregenStep.commentTo, false, false);
        if (!stepIndexerResult.result) {
            LOG.error(`Pregen rename failed at step ${pregenStep.label} in rename generated file.`); finalResult = false;}
        }

    const rootIndexerResult = await fileindexer.renameFile(fileindexer.cmspath, fileindexer.cmspathTo, undefined, false, true); 
    await fileindexer.end(); if (!rootIndexerResult.result) LOG.error(`Pregen failed at renaming original file (AI DB rename failure).`);
    return rootIndexerResult.result && finalResult;
}

async function _getPregenStepsAIApp(fileindexer) {
    const pregenStepObjects = await aiapp.getPregenObject(fileindexer.id, fileindexer.org, fileindexer.aiappid);
    const pregenFunctions = []; for (const pregenStepObject of pregenStepObjects) {
        const genfilesDir = NEURANET_CONSTANTS.GENERATED_FILES_FOLDER,
            cmspath = `${path.dirname(fileindexer.cmspath)}/${genfilesDir}/${pregenStepObject.in.pathid}_${path.basename(fileindexer.cmspath)}`,
            cmspathTo = fileindexer.cmspathTo ? `${path.dirname(fileindexer.cmspathTo)}/${genfilesDir}/${pregenStepObject.in.pathid}_${path.basename(fileindexer.cmspathTo)}` : undefined,
            comment = `${pregenStepObject.in.label}: ${path.basename(fileindexer.cmspath)}`,
            commentTo = fileindexer.cmspathTo ? `${pregenStepObject.in.label}: ${path.basename(fileindexer.cmspathTo)}` : undefined;
        const [command, command_function] = pregenStepObject.command.split(".");
        pregenFunctions.push({
            generate: async fileindexer => (await aiapp.getCommandModule(fileindexer.id, fileindexer.org, 
                fileindexer.aiappid, command))[command_function||aiapp.DEFAULT_ENTRIES.pregen_flow](fileindexer, pregenStepObject.in),
            label: pregenStepObject.in.label,
            cmspath, comment, cmspathTo, commentTo
        });
    }
        
    return pregenFunctions;
}

async function _condition_to_run_met(pregenStep) {
    const condition_code = pregenStep["condition-js"];
    if (condition_code) return await _runJSCode(condition_code, {NEURANET_CONSTANTS, 
        require: function() {const module = require(...arguments); return module}, fileindexer }); 
    else return true;   // no condition specified
}

async function _runJSCode(code, context) {
    try {return await (utils.createAsyncFunction(code)(context))} catch (err) {
        LOG.error(`Error running custom JS code error is: ${err}`); return false;
    }
}