/**
 * Utility functions for Neuranet AI.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const fspromises = require("fs").promises;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const DEBUG_RUN = NEURANET_CONSTANTS.CONF.debug_mode;
const PROMPT_CACHE = {};

exports.getPrompt = async function(promptFile) {
    if (DEBUG_RUN) return await fspromises.readFile(promptFile, "utf-8");

    const pathToFile = path.resolve(promptFile);
    if (!PROMPT_CACHE[pathToFile]) PROMPT_CACHE[pathToFile] = await fspromises.readFile(pathToFile, "utf-8");
    return  PROMPT_CACHE[pathToFile];
}

exports.getAIModel = async function(model) {
    if (!DEBUG_RUN) return NEURANET_CONSTANTS.CONF.ai_models[model];

    const confFile = await fspromises.readFile(`${NEURANET_CONSTANTS.CONFDIR}/neuranet.json`, "utf8");
    const renderedFile = mustache.render(confFile, NEURANET_CONSTANTS).replace(/\\/g, "\\\\");
    const jsonConf = JSON.parse(renderedFile);
    return jsonConf.ai_models[model];   // escape windows paths
}
