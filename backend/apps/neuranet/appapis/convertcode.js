/**
 * AI based Code convertor. 
 * (C) 2022 TekMonks. All rights reserved.
 */

const fspromises = require("fs").promises;
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const codevalidator = require(`${NEURANET_CONSTANTS.LIBDIR}/codevalidator.js`);
const LANG_MAPPINGS = require(`${NEURANET_CONSTANTS.CONFDIR}/langmappings.json`).mappings; 
const SUPPORTED_LANGS = require(`${NEURANET_CONSTANTS.CONFDIR}/langmappings.json`).supported_langs; 

const DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;
const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
		BAD_INPUT_CODE: "badinputcode"}, MODEL_DEFAULT = "lang-code-gen35", DEFAULT = "default";

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got code conversion request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	const codeInputValidationResult = jsonReq.skipvalidation?{isOK:true}:
		await codevalidator.validate(jsonReq.request, jsonReq.langfrom, undefined, jsonReq.use_simple_validator); 
	if (!codeInputValidationResult.isOK) return {reason: REASONS.BAD_INPUT_CODE, 
		parser_error: codeInputValidationResult.errors, ...CONSTANTS.FALSE_RESULT};

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT,
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse].driver.module}`;
	let aiLibrary; try{aiLibrary = require(aiModuleToUse);} catch (err) {
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
		const code = response.airesponse; const validationResult = await codevalidator.validate(code, jsonReq.langto, 
			undefined, jsonReq.use_simple_validator);
		return {code, reason: REASONS.OK, possible_error: validationResult.isOK?undefined:true, 
			parser_error: validationResult.isOK?undefined:validationResult.errors, ...CONSTANTS.TRUE_RESULT};
	}
}

const _getPromptFile = async (langfrom, langto) => {
	const langmappings = await _getLangMappings();
	return langmappings[`${langfrom}_${langto}`]?.promptfile_lang ||
		langmappings[`${langfrom}_*`]?.promptfile_lang || langmappings[`*_${langto}`]?.promptfile_lang || 
		langmappings[DEFAULT]?.promptfile_lang;
}

const _getLangMappings = async _ => {
	if (DEBUG_MODE) return JSON.parse(await fspromises.readFile(`${NEURANET_CONSTANTS.CONFDIR}/langmappings.json`)).mappings;
	else return LANG_MAPPINGS;
}
 
const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.request && jsonReq.langfrom && jsonReq.langto &&
	Object.keys(SUPPORTED_LANGS).includes(jsonReq.langfrom) && Object.keys(SUPPORTED_LANGS).includes(jsonReq.langto));