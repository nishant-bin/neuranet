/**
 * AI based SQL convertor. 
 * (C) 2022 TekMonks. All rights reserved.
 */

const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const sqlvalidator = require(`${NEURANET_CONSTANTS.LIBDIR}/sqlvalidator.js`);
const DB_MAPPINGS = require(`${NEURANET_CONSTANTS.CONFDIR}/dbmappings.json`); 

const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
		BAD_INPUT_SQL: "badinputsql"}, MODEL_DEFAULT = "sql-code-gen35";

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got SQL conversion request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	const sqlInputValidationResult = jsonReq.skipvalidation?{isOK:true}:
		await sqlvalidator.validate(jsonReq.request, jsonReq.dbfrom, undefined, jsonReq.use_simple_validator); 
	if (!sqlInputValidationResult.isOK) return {reason: REASONS.BAD_INPUT_SQL, 
		parser_error: sqlInputValidationResult.errors, ...CONSTANTS.FALSE_RESULT};

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT,
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse].driver.module}`;
	let aiLibrary; try{aiLibrary = require(aiModuleToUse);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
	const response = await aiLibrary.process({request: jsonReq.request, dbfrom: DB_MAPPINGS[jsonReq.dbfrom].label, 
		dbto: DB_MAPPINGS[jsonReq.dbto].label}, 
		`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${_getPromptFile(jsonReq.request, jsonReq.dbto)}`, 
		aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
		const sql = response.airesponse; const validationResult = sqlvalidator.validate(sql, jsonReq.dbto, 
			undefined, jsonReq.use_simple_validator);
		return {sql, reason: REASONS.OK, possible_error: validationResult.isOK?undefined:true, 
			parser_error: validationResult.isOK?undefined:validationResult.errors, ...CONSTANTS.TRUE_RESULT};
	}
}

const _isStoredProcedure = sql => sql.match(/create[' '\t]+procedure/i);

const _getPromptFile = (sql, dbType) => _isStoredProcedure(sql) ? 
	(DB_MAPPINGS[dbType].promptfile_storedproc || DB_MAPPINGS[DEFAULT].promptfile_storedproc) :
	(DB_MAPPINGS[dbType].promptfile_sql || DB_MAPPINGS[DEFAULT].promptfile_sql);

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.request && jsonReq.dbfrom && jsonReq.dbto &&
	DB_MAPPINGS[jsonReq.dbfrom] && DB_MAPPINGS[jsonReq.dbto]);