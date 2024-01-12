/**
 * Runs AI app's LLM flows.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

const DEFAULT_OUT = "lastLLMFlowStepOutput";

/** Response reasons for LLM flows */
exports.REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
    LIMIT: "limit", NOKNOWLEDGE: "noknowledge"};

/**
 * Runs LLM flows that generate the final answer to a query.
 * @param {string} query The incoming query
 * @param {string} id The ID of the user
 * @param {string} org The org of the user
 * @param {string} aiappid The AI app requested
 * @returns {Object} Final answer as {result: true|false,  response: set if result is true,error: set if result is false}. 
 */
exports.answer = async function(query, id, org, aiappid) {
    const working_memory = {
        __error: false, __error_message: "", query, id, org, aiappid,
        return_error: message => {this.__error = true; __error_message = message; LOG.error(message);}
    };

    const llmflowCommands = await aiapp.getLLMGenObject(id, org, aiappid); 
    for (const llmflowCommandDefinition of llmflowCommands) {
        const llmflowModule = await aiapp.getCommandModule(id, org, llmflowCommandDefinition.command);
        const callParams = {id, org, query}; for (const [key, value] of Object.entries(llmflowCommandDefinition))
            callParams[key] = mustache.render(value, working_memory);
        working_memory[llmflowCommandDefinition.out||DEFAULT_OUT] = 
            await llmflowModule.answer(callParams, llmflowCommandDefinition);
        if (working_memory.__error) break;
    }

    if (!working_memory.__error) return {...CONSTANTS.TRUE_RESULT, response: working_memory.airesponse};
    else return {...CONSTANTS.FALSE_RESULT, error: __error_message};
}