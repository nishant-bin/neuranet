/**
 * AI based Code convertor. 
 * (C) 2022 TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const LANG_MAPPINGS_FILE = `${NEURANET_CONSTANTS.CONFDIR}/langmappings.json`; 
const codevalidator = utils.requireWithDebug(`${NEURANET_CONSTANTS.LIBDIR}/codevalidator.js`, NEURANET_CONSTANTS.CONF.debug_mode);

const DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;
const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
	BAD_INPUT_CODE: "badinputcode", LIMIT: "limit"}, MODEL_DEFAULT = "lang-code-gen35", DEFAULT = "default";

let LANG_MAPPINGS, SUPPORTED_LANGS; 

exports.doService = async jsonReq => {
	_refreshLangFilesIfDebug();

	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got code conversion request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	if (!(await quota.checkQuota(jsonReq.id))) {
		LOG.error(`Disallowing the API call, as the user ${jsonReq.id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}
	
	const codeInputValidationResult = jsonReq.skipvalidation?{isOK:true}:
		await codevalidator.validate(jsonReq.request, jsonReq.langfrom, undefined, jsonReq.use_simple_validator); 
	if (!codeInputValidationResult.isOK) return {reason: REASONS.BAD_INPUT_CODE, 
		parser_error: codeInputValidationResult.errors, ...CONSTANTS.FALSE_RESULT};

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT,
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse].driver.module}`;
	let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
		LOG.error(`Bad AI Library or model - ${aiModuleToUse}. The error is ${err}`); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
	const response = await aiLibrary.process({request: jsonReq.request, 
			langfrom: SUPPORTED_LANGS[jsonReq.langfrom].label, langto: SUPPORTED_LANGS[jsonReq.langto].label}, 
		`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${await _getPromptFile(jsonReq.langfrom, jsonReq.langto)}`, 
		aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
		dblayer.logUsage(jsonReq.id, response.metric_cost, aiModelToUse);
		const code = response.airesponse; const validationResult = await codevalidator.validate(code, jsonReq.langto, 
			undefined, jsonReq.use_simple_validator);
		return {code, reason: REASONS.OK, possible_error: validationResult.isOK?undefined:true, 
			parser_error: validationResult.isOK?undefined:validationResult.errors, ...CONSTANTS.TRUE_RESULT};
	}
}

const _getPromptFile = async (langfrom, langto) => {
	const LANG_MAPPING_TO_USE = LANG_MAPPINGS.mappings[`${langfrom}_${langto}`] ||
		LANG_MAPPINGS.mappings[`${langfrom}_*`] || 
		LANG_MAPPINGS.mappings[`*_${langto}`] || 
		LANG_MAPPINGS.mappings[DEFAULT];
	return LANG_MAPPING_TO_USE.promptfile_lang;
}
	

const _refreshLangFilesIfDebug = _ => {
    if ((!DEBUG_MODE) && LANG_MAPPINGS && SUPPORTED_LANGS) return;
    LANG_MAPPINGS = utils.requireWithDebug(LANG_MAPPINGS_FILE, DEBUG_MODE);
    SUPPORTED_LANGS = LANG_MAPPINGS.supported_langs;
    const confjson = mustache.render(fs.readFileSync(`${NEURANET_CONSTANTS.CONFDIR}/neuranet.json`, "utf8"), 
        NEURANET_CONSTANTS).replace(/\\/g, "\\\\");   // escape windows paths
    NEURANET_CONSTANTS.CONF = JSON.parse(confjson);
}
 
const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.request && jsonReq.langfrom && jsonReq.langto &&
	Object.keys(SUPPORTED_LANGS).includes(jsonReq.langfrom) && Object.keys(SUPPORTED_LANGS).includes(jsonReq.langto));