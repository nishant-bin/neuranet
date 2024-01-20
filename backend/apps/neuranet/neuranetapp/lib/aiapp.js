/**
 * Deals with AI apps.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const yaml = require("yaml");
const fspromises = require("fs").promises;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);

const APP_CACHE = {}, PREGENFLOW_CACHE = {}, LLMGENFLOW_CACHE = {}, DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;

exports.DEFAULT_ENTRIES = {llm_flow: "answer", pregen_flow: "generate"}

/**
 * Returns the pre gen object (pregen_flow) of the YAML file for the given ai application
 * @param {string} id The ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns The pre-gen (pregen_flow) object of the YAML file for the given ai application
 */
exports.getPregenObject = async function(id, org, aiappid) {
    const app = await exports.getAIApp(id, org, aiappid), pregenFlowCacheKey = `${id}_${org}_${aiappid}`;

    if (!app.pregen_flow) return [];

    if (typeof app.pregen_flow === "string") {  // pregen flow is in an external file
        if (PREGENFLOW_CACHE[pregenFlowCacheKey] && (!DEBUG_MODE)) return PREGENFLOW_CACHE[pregenFlowCacheKey];
        else PREGENFLOW_CACHE[pregenFlowCacheKey] = app.pregen_flow.toLowerCase().endsWith("yaml") ?
            yaml.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app.pregen_flow}`, "utf8")) :
            JSON.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app.pregen_flow}`, "utf8"));
        return PREGENFLOW_CACHE[pregenFlowCacheKey];
    } else return app.pregen_flow;  // pregen flow is inline
}

/**
 * Returns the LLM gen object (llm_flow) of the YAML file for the given ai application
 * @param {string} id The ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns The LLM gen object (llm_flow) of the YAML file for the given ai application
 */
exports.getLLMGenObject = async function(id, org, aiappid) {
    const app = await exports.getAIApp(id, org, aiappid), llmgenFlowCacheKey = `${id}_${org}_${aiappid}`;

    if (typeof app.llm_flow === "string") {  // llm flow is in an external file
        if (LLMGENFLOW_CACHE[llmgenFlowCacheKey] && (!DEBUG_MODE)) return LLMGENFLOW_CACHE[llmgenFlowCacheKey];
        else LLMGENFLOW_CACHE[llmgenFlowCacheKey] = app.llm_flow.toLowerCase().endsWith("yaml") ?
            yaml.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app.llm_flow}`, "utf8")) :
            JSON.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app.llm_flow}`, "utf8"));
        return LLMGENFLOW_CACHE[llmgenFlowCacheKey];
    } else return app.llm_flow;  // llm flow is inline
}

/**
 * Returns the AI app object itself - the overall AI app object.
 * @param {string} id The ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns The AI app object itself - the overall AI app object.
 */
exports.getAIApp = async function(id, org, aiappid) {
    const appCacheKey = `${org}_${aiappid}`;

    const app = (APP_CACHE[appCacheKey] && (!DEBUG_MODE)) ? APP_CACHE[appCacheKey] :
        yaml.parse(await fspromises.readFile(_getAppFile(id, org, aiappid), "utf8"));
    if (!APP_CACHE[appCacheKey]) APP_CACHE[appCacheKey] = app;
    return app;
}

/**
 * Returns the JS module, whether plugin or loaded from app, for YAML command modules
 * @param {string} id The ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @param {string} command The command name
 * @return The JS module, whether plugin or loaded from app, for YAML command modules
 */
exports.getCommandModule = async function(id, org, aiappid, command) {
    const aiapp = await exports.getAIApp(id, org, aiappid);
    if (aiapp.modules?.[command]) return require(`${_getAppDir(id, org, aiappid)}/${aiapp.modules[command]}`);
    else return await NEURANET_CONSTANTS.getPlugin(command);    // if it is not part of the app then must be built-in
}

/** @return For YAML keys with additional properties e.g. condition_js, returns the raw key name e.g. condition */
exports.extractRawKeyName = key => key.lastIndexOf("_") != -1 ? key.substring(0, key.lastIndexOf("_")) : key;

const _getAppFile = (id, org, aiappid) => `${_getAppDir(id, org, aiappid)}/${aiappid}.yaml`;

const _getAppDir = (id, org, aiappid) => brainhandler.isThisDefaultOrgsDefaultApp(id, org, aiappid) ?
    `${NEURANET_CONSTANTS.AIAPPDIR}/${NEURANET_CONSTANTS.DEFAULT_ORG}/${aiappid}` : `${NEURANET_CONSTANTS.AIAPPDIR}/${org}/${aiappid}`;