/**
 * Calls various GPT models for OpenAI. Uses request/response not streaming.
 * (C) 2022 TekMonks. All rights reserved.
 */

const mustache = require("mustache");
const fspromises = require("fs").promises;
const rest = require(`${CONSTANTS.LIBDIR}/rest.js`);

const PROMPT_VAR = "${__ORG_NEURANET_PROMPT__}";

exports.process = async function(data, promptFile, apiKey, model) {
    const prompt = mustache.render(await fspromises.readFile(promptFile, "utf-8"), data);   // create the prompt
    const modelObject = NEURANET_CONSTANTS.CONF.ai_models[model];
    const promptMustacheStr = JSON.stringify(modelObject.request).replace(PROMPT_VAR, "{{{prompt}}}"), 
        promptJSONStr = JSON.stringify(prompt),
        promptInjectedStr = mustache.render(promptMustacheStr, {prompt: promptJSONStr.substring(1,promptJSONStr.length-1)}),
        promptObject = JSON.parse(promptInjectedStr);
    LOG.info(`Calling AI engine for request ${JSON.stringify(data)} and prompt ${JSON.stringify(prompt)}`);
    LOG.info(`The prompt object for this call is ${JSON.stringify(promptObject)}.`);
    const response = await rest.postHttps(modelObject.driver.host, modelObject.driver.port, modelObject.driver.path, 
        {"Authorization": `Bearer ${apiKey}`}, promptObject);
    if ((!response) || (!response.data) || (response.error)) {
        LOG.error(`AI engine for request ${JSON.stringify(data)} and prompt ${JSON.stringify(prompt)}, call error, the resulting code is ${response?.status} and response data is ${response.data?typeof response.data == "string"?response.data:response.data.toString():""}.`);
        LOG.info(`The prompt object for this call is ${JSON.stringify(promptObject)}.`);
        return null;
    }

    LOG.info(`The AI response for request ${JSON.stringify(data)} and prompt object ${JSON.stringify(promptObject)} was ${JSON.stringify(response)}`);

    const readObjProperty = path => { try{return Function.call(null,`return ${path}`)();} catch(err){return null}; }
    const finishReason = readObjProperty(`response.${modelObject.response_finishreason}`);
    const messageContent = readObjProperty(`response.${modelObject.response_contentpath}`);
    if (!messageContent) {
        LOG.error(`Response from AI engine for request ${data} and prompt ${prompt} is missing content.`); return null; }
    else if (finishReason != "stop") {
        LOG.error(`Response from AI engine for request ${data} and prompt ${prompt} didn't stop properly.`); return null; }
    else return {airesponse: messageContent};
}