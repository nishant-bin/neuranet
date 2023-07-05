/**
 * A simple module to send a templated or a raw prompt, inflated with data, to any AI LLM
 * and then return the answer back.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const mustache = require("mustache");
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);

const DEFAULT_SIMPLE_QA_MODEL = "simplellm-gpt35-turbo", DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;

/**
 * Sends the given prompt to the indicated LLM and returns its raw response.
 * @param {string} promptFileOrPrompt Path to a prompt file or the full prompt itself if no data is provided to inflate the prompt.
 * @param {string} id The user ID on behalf of whom we are processing this request. If not given then LLM costs can't be updated.
 * @param {object} data The prompt template data. If null then it is assume the promptFileOrPrompt is a full prompt.
 * @param {string} model The LLM model name to use. If not provided then a default is used.
 * @returns The LLM response, unparsed.
 */
exports.prompt_answer = async function(promptFileOrPrompt, id, data, model=DEFAULT_SIMPLE_QA_MODEL) {
    if (id && !(await quota.checkQuota(id))) {  // check quota if the ID was provided
		LOG.error(`SimpleLLM: Disallowing the LLM call, as the user ${id} is over their quota.`);
		return null;    // quota issue
	}

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
        aiModelToUse = model || DEFAULT_SIMPLE_QA_MODEL, aiModelObject = await aiutils.getAIModel(aiModelToUse),
        aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObject.driver.module}`;

    let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
        LOG.error(`SimpleLLM: Bad AI Library or model - ${aiModuleToUse}.`); 
        return null;    // bad AI library or model
    }

    const prompt = (data?mustache.render(await aiutils.getPrompt(promptFileOrPrompt), data):promptFileOrPrompt).replace(/\r\n/gm,"\n");
    const promptJSONForAILib = JSON.stringify([{role: aiModelObject.system_role, 
        content: aiModelObject.system_message}, {role: aiModelObject.user_role, content: prompt}]);

    const response = await aiLibrary.process(null, promptJSONForAILib, aiKey, aiModelToUse, true);
    if (!response) {
        LOG.error("SimpleLLM: LLM API library returned internal error (null reponse)."); 
        return null; // LLM call error
    }

    if (id) dblayer.logUsage(id, response.metric_cost, aiModelToUse);
    return response.airesponse;
}
