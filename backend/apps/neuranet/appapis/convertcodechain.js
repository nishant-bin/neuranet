/**
 * AI based Code convertor using AGI chains.
 * jsonReq.request is an array of [{context:"context name", data:"code to work on"},...]
 * (C) 2022 TekMonks. All rights reserved.
 */
const fs = require("fs");
const fspromises = fs.promises;
const mustache = require("mustache");
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const LANG_MAPPINGS_FILE = `${NEURANET_CONSTANTS.CONFDIR}/langmappings.json`; 
const LANG_CHAINS_FILE = `${NEURANET_CONSTANTS.CONFDIR}/langchaindriver.json`; 
const codevalidator = require(`${NEURANET_CONSTANTS.LIBDIR}/codevalidator.js`);

const DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;
const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
		BAD_INPUT_CODE: "badinputcode"}, MODEL_DEFAULT = "lang-code-chaingen35", DEFAULT = "default";

let LANG_MAPPINGS, LANG_CHAINS, SUPPORTED_LANGS; 

exports.doService = async jsonReq => {
    _refreshLangFilesIfDebug();

	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got code conversion request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	const codeInputValidationResult = jsonReq.skipvalidation?{isOK:true}:
		await codevalidator.validate(jsonReq.request, jsonReq.langfrom, undefined, jsonReq.use_simple_validator); 
	if (!codeInputValidationResult.isOK) return {reason: REASONS.BAD_INPUT_CODE, 
		parser_error: codeInputValidationResult.errors, ...CONSTANTS.FALSE_RESULT};

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT, aiModelObject = NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse],
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObject.driver.module}`;
	let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
		LOG.error(`Bad AI Library or model - ${aiModuleToUse}. The error is ${err}`); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
    const requestChain = Array.isArray(jsonReq.request)?jsonReq.request:[jsonReq.request];
    const responses = [], allValidationsOK = true, validationErrors = [];
    if (!aiModelObject.read_ai_response_from_samples) for (const request of requestChain) {
        const promptFile = _getPromptFile(request.context.toLowerCase(), jsonReq.langfrom.toLowerCase(), 
            jsonReq.langto.toLowerCase());
        const response = await aiLibrary.process({request: request.data, 
			langfrom: SUPPORTED_LANGS[jsonReq.langfrom].label, langto: SUPPORTED_LANGS[jsonReq.langto].label}, 
		`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${promptFile}`, aiKey, aiModelToUse);

        if (!response) {    // on any chain error, break out with an error
            LOG.error(`AI library error processing request on chain ${JSON.stringify(request)}.`); 
            return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
        }
        const code = response.airesponse, validationResult = await codevalidator.validate(code, 
            jsonReq.langto, undefined, jsonReq.use_simple_validator);
        if (!validationResult.isOK) {allValidationsOK = false; validationErrors.push(...validationResult.errors);}
        responses.push({context: request.context, code});
    } else responses.push(...utils.requireWithDebug(`${NEURANET_CONSTANTS.RESPONSESDIR}/${aiModelObject.sample_ai_response}`, true));

    const responsePromptFilePath = NEURANET_CONSTANTS.TRAININGPROMPTSDIR+"/"+_getPromptFile("response", jsonReq.langfrom, jsonReq.langto);
    const responsePreProcessor = utils.requireWithDebug(
        NEURANET_CONSTANTS.LIBDIR+"/"+_getPromptFile("response_preprocessor", jsonReq.langfrom, jsonReq.langto));
    const finalResponse = mustache.render(await _readPromptFile(responsePromptFilePath), 
        responsePreProcessor.getResponse(responses));

    return {code: finalResponse, reason: REASONS.OK, possible_error: allValidationsOK?undefined:true, 
		parser_error: allValidationsOK?undefined:validationErrors, ...CONSTANTS.TRUE_RESULT};
}

const _getPromptFile = (context, langfrom, langto) => {
	return LANG_CHAINS[`${context}_${langfrom}_${langto}`] ||
        LANG_CHAINS[`${context}_${langfrom}_*`] || 
        LANG_CHAINS[`${context}_*_${langto}`] || 
        LANG_CHAINS[`${context}_*_*`] ||
		LANG_CHAINS[DEFAULT];
}

const _readPromptFile = async path => {
    if (DEBUG_MODE) return (await fspromises.readFile(path, "utf-8"));
    else if (!FILE_CONTENTS_CACHE[path.resolve(path)]) FILE_CONTENTS_CACHE[path.resolve(path)] = 
        await fspromises.readFile(path, "utf-8");

    return FILE_CONTENTS_CACHE[path.resolve(path)];
}

const _refreshLangFilesIfDebug = _ => {
    if ((!DEBUG_MODE) && LANG_CHAINS && LANG_MAPPINGS) return;
    LANG_MAPPINGS = utils.requireWithDebug(LANG_MAPPINGS_FILE, DEBUG_MODE);
    LANG_CHAINS = utils.requireWithDebug(LANG_CHAINS_FILE, DEBUG_MODE);
    SUPPORTED_LANGS = LANG_MAPPINGS.supported_langs;
    const confjson = mustache.render(fs.readFileSync(`${NEURANET_CONSTANTS.CONFDIR}/neuranet.json`, "utf8"), 
        NEURANET_CONSTANTS).replace(/\\/g, "\\\\");   // escape windows paths
    global.NEURANET_CONSTANTS.CONF = JSON.parse(confjson);
}
 
const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.request && jsonReq.langfrom && 
    jsonReq.langto && Object.keys(SUPPORTED_LANGS).includes(jsonReq.langfrom) &&
    Object.keys(SUPPORTED_LANGS).includes(jsonReq.langto));