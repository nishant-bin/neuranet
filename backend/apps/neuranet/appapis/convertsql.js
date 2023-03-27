/**
 * AI based SQL convertor. 
 * (C) 2022 TekMonks. All rights reserved.
 */

const sqlparser = require("node-sql-parser");
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const DB_MAPPINGS = require(`${NEURANET_CONSTANTS.CONFDIR}/dbmappings.json`); 

const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", BAD_INPUT_SQL: "badinputsql"}, 
	DBPROMPT = "dbprompt.txt", MODEL_DEFAULT = "sql-code-gen35", SQL_PARSER = new sqlparser.Parser();

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}
	
	LOG.debug(`Got SQL conversion request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	const sqlInputValidationResult = _validateSQL(jsonReq.request, jsonReq.skipvalidation); 
	if (!sqlInputValidationResult.isOK) return {reason: REASONS.BAD_INPUT_SQL, parser_error: sqlInputValidationResult.error, ...CONSTANTS.FALSE_RESULT};

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT,
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse].driver.module}`;
	let aiLibrary; try{aiLibrary = require(aiModuleToUse);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
	const response = await aiLibrary.process({request: jsonReq.request, dbfrom: DB_MAPPINGS[jsonReq.dbfrom], dbto: DB_MAPPINGS[jsonReq.dbto]}, 
		`${NEURANET_CONSTANTS.PROMPTSDIR}/${DBPROMPT}`, aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
		const sql = response.airesponse; const validationResult = _validateSQL(sql);
		return {sql, reason: REASONS.OK, possible_error: validationResult.isOK?undefined:true, 
			parser_error: validationResult.isOK?undefined:validationResult.error, ...CONSTANTS.TRUE_RESULT};
	}
}

const _validateSQL = (sql, skipValidation) => { 
	if (skipValidation) return {isOK: true};
	try { SQL_PARSER.parse(sql); return {isOK: true}; } catch (err) { return {isOK: false, error: err};}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.request && jsonReq.dbfrom && jsonReq.dbto &&
	DB_MAPPINGS[jsonReq.dbfrom] && DB_MAPPINGS[jsonReq.dbto]);