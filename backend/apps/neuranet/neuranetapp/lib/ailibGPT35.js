/**
 * Calls various GPT models for OpenAI. Uses request/response not streaming.
 * (C) 2022 TekMonks. All rights reserved.
 */

const mustache = require("mustache");
const fspromises = require("fs").promises;
const rest = require(`${CONSTANTS.LIBDIR}/rest.js`);
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);

const PROMPT_VAR = "${__ORG_NEURANET_PROMPT__}", SAMPLE_MODULE_PREFIX = "module(";

exports.process = async function(data, promptFile, apiKey, model) {
    const prompt = mustache.render(await aiutils.getPrompt(promptFile), data).replace(/\r\n/gm,"\n");   // create the prompt
    const modelObject = await aiutils.getAIModel(model); 
    if (!modelObject) { LOG.error(`Bad model object - ${modelObject}.`); return null; }

    const tokencount_request = await exports.countTokens(prompt, modelObject.request.model, modelObject.token_approximation_uplift);
    if (tokencount_request > modelObject.request.max_tokens - 1) {
        LOG.error(`Request too large for the model's context length - the token count is ${tokencount_request}, the model's max context length is ${modelObject.request.model}.`); 
        LOG.error(`The request prompt was ${JSON.stringify(prompt)}`);
        return null; 
    } else modelObject.request.max_tokens = modelObject.request.max_tokens - tokencount_request;

    let promptObject;
    if (!modelObject.request_contentpath)
    {   
        const promptMustacheStr = JSON.stringify(modelObject.request).replace(PROMPT_VAR, "{{{prompt}}}"), 
            promptJSONStr = JSON.stringify(prompt),
            promptInjectedStr = mustache.render(promptMustacheStr, {prompt: promptJSONStr.substring(1,promptJSONStr.length-1)});
        promptObject = JSON.parse(promptInjectedStr);
    } else {
        promptObject = {...modelObject.request};
        utils.setObjProperty(promptObject, modelObject.request_contentpath, JSON.parse(prompt));
    }
        
    LOG.info(`Calling AI engine for request ${JSON.stringify(data)} and prompt ${JSON.stringify(prompt)}`);
    LOG.info(`The prompt object for this call is ${JSON.stringify(promptObject)}.`);
    if (modelObject.read_ai_response_from_samples) LOG.info("Reading sample response as requested by the model.");
    const response = modelObject.read_ai_response_from_samples ? await _getSampleResponse(modelObject.sample_ai_response) : 
        await rest.postHttps(modelObject.driver.host, modelObject.driver.port, modelObject.driver.path, 
            {"Authorization": `Bearer ${apiKey}`}, promptObject);

    if ((!response) || (!response.data) || (response.error)) {
        LOG.error(`Error: AI engine call error.`);
        if (response) LOG.error(`The resulting code is ${response.status} and response data is ${response.data?typeof response.data == "string"?response.data:response.data.toString():""}.`);
        else LOG.error(`The response from AI engine is null.`);
        LOG.info(`The prompt object for this call is ${JSON.stringify(promptObject)}.`);
        return null;
    }

    LOG.info(`The AI response for request ${JSON.stringify(data)} and prompt object ${JSON.stringify(promptObject)} was ${JSON.stringify(response)}`);

    const finishReason = modelObject.response_finishreason ?
            utils.getObjProperty(response, modelObject.response_finishreason) : null,
        messageContent = utils.getObjProperty(response, modelObject.response_contentpath);
        
    if (!messageContent) {
        LOG.error(`Response from AI engine for request ${data} and prompt ${prompt} is missing content.`); return null; }
    else if (modelObject.response_finishreason && (!modelObject.response_ok_finish_reasons.includes(finishReason))) {
        LOG.error(`Response from AI engine for request ${data} and prompt ${prompt} didn't stop properly.`); return null; }
    else return {airesponse: messageContent, metric_cost: modelObject.response_cost_of_query_path?
        utils.getObjProperty(response, modelObject.response_cost_of_query_path) : undefined};
}

exports.countTokens = async function(string, AImodel, uplift=1.05) {
    let count, encoderLib; try {encoderLib = require("gpt-tokenizer")} catch (err) {LOG.warn(`GPT3 encoder library not available for estimation, using approximate estimation method instead. The error is ${err}.`);}
    if ((AImodel.includes("gpt-3") || AImodel.includes("gpt-4")) && encoderLib) {
        const encoded = encoderLib.encode(string);
        count = encoded.length;
    } else {
        if (encoderLib) LOG.warn(`${AImodel} is not supported using encoder, using the approximate estimation method to calculate tokens.`);
        count = (string.length/4); 
    }
    return Math.ceil(count*uplift);
}

async function _getSampleResponse(sampleAIReponseDirective) {
    if (!sampleAIReponseDirective.trim().startsWith(SAMPLE_MODULE_PREFIX)) return JSON.parse(await fspromises.readFile(
        `${NEURANET_CONSTANTS.RESPONSESDIR}/${sampleAIReponseDirective}`));

    const tuples = sampleAIReponseDirective.trim().split(","); for (const [i, tuple] of Object.entries(tuples)) tuples[i] = tuple.trim(); 

    const moduleToRun = tuples[0].substring(SAMPLE_MODULE_PREFIX.length, tuples[0].length-1), modulePath = `${NEURANET_CONSTANTS.RESPONSESDIR}/${moduleToRun}`;
    try {
        const moduleLoaded = require(modulePath);
        return await moduleLoaded.getSampleResponse(...tuples.slice(1));
    } catch (err) {
        LOG.error(`Error loading sample response module. Error is ${err}.`);
        return null;
    }
}