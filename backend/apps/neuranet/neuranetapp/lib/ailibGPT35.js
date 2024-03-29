/**
 * Calls various GPT models using OpenAI message format. 
 * Uses request/response not streaming.
 * (C) 2022 TekMonks. All rights reserved.
 */

const mustache = require("mustache");
const fspromises = require("fs").promises;
const rest = require(`${CONSTANTS.LIBDIR}/rest.js`);
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/../3p/langdetector.js`);

const PROMPT_VAR = "${__ORG_NEURANET_PROMPT__}", SAMPLE_MODULE_PREFIX = "module(", DEFAULT_GPT_CHARS_PER_TOKEN = 4,
    DEFAULT_GPT_TOKENS_PER_WORD = 1.25, INTERNAL_TOKENIZER = "internal", DEFAULT_GPT_TOKENIZER = "gpt-tokenizer", 
    DEFAULT_TOKEN_UPLIFT = 1.05, DEFAULT_AI_API_RETRIES = 5, DEFAULT_AI_API_BACKOFF_WAIT = 150, 
    DEFAULT_AI_API_BACKOFF_EXPONENT=2, DEFAULT_AI_API_TIMEOUT_WAIT=60000, MAX_LOG_NON_VERBOSE_TRUNCATE = 250;

/**
 * Runs the AI LLM.
 * @param {object} data The prompt data
 * @param {string} promptOrPromptFile The prompt or a file which contains the prompt, as a Mustache template
 * @param {string} apiKey The API key for the API call
 * @param {string|object} model The model object or name of the model to load
 * @param {boolean} dontInflatePrompt If true, then the prompt is not inflated using the data
 * @param {boolean} forceNonVerboseLog Force non verbose logging
 * @returns {object} null on errors or an object of format {airesponse: messageContent, metric_cost: LLM_metric_cost}
 */
exports.process = async function(data, promptOrPromptFile, apiKey, model, dontInflatePrompt, forceNonVerboseLog=false) {
    const prompt = dontInflatePrompt ? promptOrPromptFile : mustache.render(await aiutils.getPrompt(promptOrPromptFile), data).replace(/\r\n/gm,"\n");   // create the prompt
    const modelObject = typeof model === "object" ? model : await aiutils.getAIModel(model); 
    if (!modelObject) { LOG.error(`Bad model object - ${modelObject}.`); return null; }
    const verboseLogging = (!forceNonVerboseLog) && NEURANET_CONSTANTS.CONF.verbose_log;

    const tokencount_request = await exports.countTokens(prompt, modelObject.request.model, 
        modelObject.token_approximation_uplift, modelObject.tokenizer);
    if (tokencount_request > modelObject.request.max_tokens - 1) {
        LOG.error(`Request too large for the model's context length - the token count is ${tokencount_request}, the model's max context length is ${modelObject.request.max_tokens}.`); 
        LOG.error(`The request prompt was ${JSON.stringify(prompt)}`);
        return null; 
    } 
    if (modelObject.request.max_tokens) delete modelObject.request.max_tokens;  // retaining this causes many errors in OpenAI as the tokencount is always approximate, while this value - if provided - must be absolutely accurate

    let promptObject;
    if (!modelObject.request_contentpath)
    {   
        const promptMustacheStr = JSON.stringify(modelObject.request).replace(PROMPT_VAR, "{{{prompt}}}"), 
            promptJSONStr = JSON.stringify(prompt),
            promptInjectedStr = mustache.render(promptMustacheStr, {prompt: promptJSONStr.substring(1,promptJSONStr.length-1)});
        if (verboseLogging) LOG.info(`Pre JSON parsing, the raw prompt object is: ${promptJSONStr}`);
        promptObject = JSON.parse(promptInjectedStr);
    } else {
        promptObject = {...modelObject.request};
        if (verboseLogging) LOG.info(`Pre JSON parsing, the raw prompt is: ${prompt}`);
        utils.setObjProperty(promptObject, modelObject.request_contentpath, JSON.parse(prompt));
    }

    LOG.info(`Calling AI engine for request ${JSON.stringify(data)} and prompt ${JSON.stringify(prompt)}`);
    if (verboseLogging) LOG.info(`The prompt object for this call is ${JSON.stringify(promptObject)}.`);
    if (modelObject.read_ai_response_from_samples) LOG.info("Reading sample response as requested by the model.");

    let response, retries = 0;
    const _postAIRequest = _ => rest.postHttps(modelObject.driver.host, modelObject.driver.port, 
        modelObject.driver.path, {"Authorization": modelObject.isBasicAuth ? `Basic ${apiKey}` : `Bearer ${apiKey}`, 
            ...(modelObject.x_api_key ? {"x-api-key": modelObject.x_api_key} : {})}, promptObject);
    const _is200ResponseStatus = status => typeof status !== "number" ? false : 
        Math.trunc(status / 200) == 1 && status % 200 < 100;
    do {    // auto retry if API is overloaded (eg 503 error)
        let backoffwait = 0; if (retries > 0) {
            backoffwait = Math.pow(modelObject.driver.backoffexponent||DEFAULT_AI_API_BACKOFF_EXPONENT, retries-1) * 
                ((modelObject.driver.backoffwait||DEFAULT_AI_API_BACKOFF_WAIT)*(1+Math.random()));
            LOG.warn(`Retrying with backoff wait of ${(modelObject.driver.backoffwait||DEFAULT_AI_API_BACKOFF_WAIT)*retries} ms.`);
        }
        try {
            retries++; response = await (modelObject.read_ai_response_from_samples ? 
                _getSampleResponse(modelObject.sample_ai_response) : 
                _callFunctionWithWaitAndTimeout(_postAIRequest, backoffwait, modelObject.driver.api_wait_timeout||DEFAULT_AI_API_TIMEOUT_WAIT));
        } catch (error) {
            LOG.error(`The AI engine failed to provide a response due to ${error}`);
            response = {status: "unknown"}
        }
    } while (response && (modelObject.driver.http_retry_codes && 
            (modelObject.driver.http_retry_codes.includes(response.status)||modelObject.driver.http_retry_codes.includes("*")))
        && (retries <= (modelObject.driver.api_overloaded_max_retries||DEFAULT_AI_API_RETRIES)) && (!_is200ResponseStatus(response.status)))

    if ((!response) || (!response.data) || (response.error)) {
        LOG.error(`Error: AI engine call error.`);
        if (response) LOG.error(`The resulting code is ${response.status} and response data is ${response.data?typeof response.data == "string"?response.data:response.data.toString():""}.`);
        else LOG.error(`The response from AI engine is null.`);
        LOG.info(`The prompt object for this call is ${JSON.stringify(promptObject)}.`);
        return null;
    }

    if (verboseLogging) LOG.info(`The AI response for request ${JSON.stringify(data)} and prompt object ${JSON.stringify(promptObject)} was ${JSON.stringify(response)}`);
    else LOG.info(`The AI response for request ${JSON.stringify(data)?.substring(0, MAX_LOG_NON_VERBOSE_TRUNCATE)} and prompt object ${JSON.stringify(promptObject).substring(0, MAX_LOG_NON_VERBOSE_TRUNCATE)} was ${JSON.stringify(response).substring(0, MAX_LOG_NON_VERBOSE_TRUNCATE)}`);

    const finishReason = modelObject.response_finishreason ?
            utils.getObjProperty(response, modelObject.response_finishreason) : null,
        messageContent = utils.getObjProperty(response, modelObject.response_contentpath);

    if (!messageContent) {
        LOG.error(`Response from AI engine for request ${JSON.stringify(data)} and prompt ${prompt} is missing content.`); return null; }
    else if (modelObject.response_finishreason && (!modelObject.response_ok_finish_reasons.includes(finishReason))) {
        LOG.error(`Response from AI engine for request ${JSON.stringify(data)} and prompt ${prompt} didn't stop properly.`); return null; }
    else return {airesponse: messageContent, metric_cost: modelObject.response_cost_of_query_path?
        utils.getObjProperty(response, modelObject.response_cost_of_query_path) : undefined};
}

exports.countTokens = async function(string, rawAIModelName, uplift=DEFAULT_TOKEN_UPLIFT, tokenizer=INTERNAL_TOKENIZER) {
    let count, encoderLib; try {
        if (tokenizer.toLowerCase() != INTERNAL_TOKENIZER) encoderLib = require(tokenizer||DEFAULT_GPT_TOKENIZER);
    } catch (err) {
        LOG.warn(`GPT3 encoder library ${tokenizer||DEFAULT_GPT_TOKENIZER} not available for estimation, using approximate estimation method instead. The error is ${err}.`);
    }
    if ((rawAIModelName.toLowerCase().includes("gpt-3") || rawAIModelName.toLowerCase().includes("gpt-4")) && encoderLib) {
        const encoded = encoderLib.encode(string);
        count = encoded.length;
    } else {
        if (encoderLib) LOG.warn(`${rawAIModelName} is not supported using encoder, using the approximate estimation method to calculate tokens.`);
        if (!encoderLib) LOG.info(`Using the approximate estimation method to calculate tokens. The tokenizer specified is ${tokenizer}.`)
        const _countWordsUsingIntl = (text, lang) => [...(new Intl.Segmenter(lang, { granularity: "word" }).segment(
            text))].reduce((wordCount, { isWordLike }) => wordCount + Number(isWordLike), 0);
        const langDetected = langdetector.getISOLang(string);
        count = ((langDetected != "ja") && (langDetected != "zh")) ? string.length/DEFAULT_GPT_CHARS_PER_TOKEN :
            (_=>{const wordcount = _countWordsUsingIntl(string, langDetected); return wordcount*DEFAULT_GPT_TOKENS_PER_WORD;})()
    }
    const tokenCount = Math.ceil(count*uplift);
    LOG.info(`Token count is ${tokenCount}. Tokenizer used is ${encoderLib?tokenizer||DEFAULT_GPT_TOKENIZER:INTERNAL_TOKENIZER}.`);
    return tokenCount;
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

async function _callFunctionWithWaitAndTimeout(callee, wait, timeout) {
    return new Promise(async (resolve, reject) => {
        const callAndResolve = async _ => {
            let resolved = false; let timeoutID; 
            if (timeout) timeoutID = setTimeout(_=>{if (!resolved) {resolved = true; reject("Timed out.");}}, timeout);
            try { const result = await callee(); if (!resolved) {
                if (timeoutID) clearTimeout(timeoutID); resolve(result); resolved=true;} } catch (err) {reject(err);};
        }
        if (wait) setTimeout(callAndResolve, wait); else callAndResolve();
    });
}