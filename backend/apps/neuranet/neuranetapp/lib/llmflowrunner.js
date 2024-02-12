/**
 * Runs AI app's LLM flows.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const mustache = require("mustache");
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

const DEFAULT_OUT = "lastLLMFlowStepOutput", CONDITION_JS = "condition_js", NOINFLATE = "_noinflate", JSCODE = "_js";

/** Response reasons for LLM flows */
exports.REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
    LIMIT: "limit", NOKNOWLEDGE: "noknowledge"};

/**
 * Runs LLM flows that generate the final answer to a query.
 * @param {string} query The incoming query
 * @param {string} id The ID of the user
 * @param {string} org The org of the user
 * @param {string} aiappid The AI app requested
 * @param {Object} request The incoming request params
 * @returns {Object} Final answer as {result: true|false,  response: set if result is true,error: set if result is false}. 
 */
exports.answer = async function(query, id, org, aiappid, request) {
    const working_memory = {
        __error: false, __error_message: "", query, id, org, aiappid, request,
        return_error: message => {this.__error = true; __error_message = message; LOG.error(message);}
    };

    const llmflowCommands = await aiapp.getLLMGenObject(id, org, aiappid); 
    for (const llmflowCommandDefinition of llmflowCommands) {
        const condition_code = llmflowCommandDefinition[CONDITION_JS] ? mustache.render(
            llmflowCommandDefinition[CONDITION_JS], working_memory) : undefined;
        if (condition_code) if (!await _runJSCode(condition_code, {NEURANET_CONSTANTS,  // run only if condition is satisfied
            require: function() {const module = require(...arguments); return module} })) continue;  

        const [command, command_function] = llmflowCommandDefinition.command.split(".");
        const llmflowModule = await aiapp.getCommandModule(id, org, aiappid, command);
        const callParams = {id, org, query, aiappid, request}; 
        for (const [key, value] of Object.entries(llmflowCommandDefinition.in)) {
            if (key.endsWith(NOINFLATE)) callParams[aiapp.extractRawKeyName(key)] = value;
            else if (key.endsWith(JSCODE)) {
                const thisvalue = await _runJSCode(value, working_memory);
                callParams[aiapp.extractRawKeyName(key)] = thisvalue;
            } else callParams[key] = typeof value === "object" ? JSON.parse(
                mustache.render(JSON.stringify(value), working_memory)) : typeof value === "string" ? 
                mustache.render(value.toString(), working_memory) : value;
        }
        working_memory[llmflowCommandDefinition.out||DEFAULT_OUT] = 
            await llmflowModule[command_function||aiapp.DEFAULT_ENTRIES.llm_flow](callParams, llmflowCommandDefinition);
        if (working_memory.__error) break;
    }

    if (!working_memory.__error) return {...CONSTANTS.TRUE_RESULT, ...(working_memory.airesponse||[])};
    else return {...CONSTANTS.FALSE_RESULT, error: __error_message};
}   

async function _runJSCode(code, context) {
    try {return await (utils.createAsyncFunction(code)(context))} catch (err) {
        LOG.error(`Error running custom JS code error is: ${err}`); return false;
    }
}