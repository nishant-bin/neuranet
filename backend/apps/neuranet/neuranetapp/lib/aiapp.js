/**
 * Deals with AI apps.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const yaml = require("yaml");
const fspromises = require("fs").promises;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);

const APP_CACHE = {}, FLOWSECTION_CACHE = {}, DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;

exports.DEFAULT_ENTRY_FUNCTIONS = {llm_flow: "answer", pregen_flow: "generate"}

/**
 * Returns the flow object of the YAML file for the given ai application
 * @param {string} id The ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @param {string} flow_section The flow section name
 * @returns The flow object of the YAML file for the given ai application
 */
exports.getAIAppObject = async function(id, org, aiappid, flow_section) {
    const app = await exports.getAIApp(id, org, aiappid), flowCacheKey = `${id}_${org}_${aiappid}_${flow_section}`;

    if (!app[flow_section]) return [];

    if (typeof app[flow_section] === "string") {  // flow is in an external file
        if (FLOWSECTION_CACHE[flowCacheKey] && (!DEBUG_MODE)) return FLOWSECTION_CACHE[flowCacheKey];
        else FLOWSECTION_CACHE[flowCacheKey] = app[flow_section].toLowerCase().endsWith("yaml") ?
            yaml.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app[flow_section]}`, "utf8")) :
            JSON.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app[flow_section]}`, "utf8"));
        return FLOWSECTION_CACHE[flowCacheKey];
    } else return app[flow_section];  // flow is inline
}

/**
 * Returns the LLM gen object (llm_flow) of the YAML file for the given ai application
 * @param {string} id The ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns The LLM gen object (llm_flow) of the YAML file for the given ai application
 */
exports.getLLMGenObject = (id, org, aiappid) => exports.getAIAppObject(id, org, aiappid, "llm_flow");

/**
 * Returns the pre gen object (pregen_flow) of the YAML file for the given ai application
 * @param {string} id The ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns The pre-gen (pregen_flow) object of the YAML file for the given ai application
 */
exports.getPregenObject = (id, org, aiappid) => exports.getAIAppObject(id, org, aiappid, "pregen_flow");

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
 * Returns AI model taking into account app's global overrides.
 * @param {string} model_name The model name
 * @param {object} model_overrides The overrides for this model, or undefined if none
 * @param {string} id The ID - if not provided then global overrides don't take effect
 * @param {string} org The org - if not provided then global overrides don't take effect
 * @param {string} aiappid The AI app ID - if not provided then global overrides don't take effect
 * @returns The AI model taking into account app's global overrides.
 */
exports.getAIModel = async function(model_name, model_overrides={}, id, org, aiappid) {
    const aiapp = (id && org && aiappid) ? await exports.getAIApp(id, org, aiappid) : {global_models: []};
    let globalOverrides = {}; for (const globalModel of aiapp.global_models) if (globalModel.name == model_name) {
        globalOverrides = globalModel.model_overrides; break; }
    const final_overrides = {...globalOverrides, ...model_overrides};
    return await aiutils.getAIModel(model_name, final_overrides);
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