/**
 * AI based SQL convertor. 
 * (C) 2022 TekMonks. All rights reserved.
 */
const fspromises = require("fs").promises;
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const sqlvalidator = require(`${NEURANET_CONSTANTS.LIBDIR}/sqlvalidator.js`);
const DB_MAPPINGS = require(`${NEURANET_CONSTANTS.CONFDIR}/dbmappings.json`).mappings; 
const SUPPORTED_DBS = require(`${NEURANET_CONSTANTS.CONFDIR}/dbmappings.json`).supported_dbs; 

const DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;
const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
	BAD_INPUT_SQL: "badinputsql", LIMIT: "limit"}, MODEL_DEFAULT = "sql-code-gen35", DEFAULT = "default";

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got SQL conversion request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	if (!(await quota.checkQuota(jsonReq.id))) {
		LOG.error(`Disallowing the API call, as the user ${jsonReq.id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}
    
	const sqlInputValidationResult = jsonReq.skipvalidation?{isOK:true}:
		await sqlvalidator.validate(jsonReq.request, jsonReq.dbfrom, undefined, jsonReq.use_simple_validator); 
	if (!sqlInputValidationResult.isOK) return {reason: REASONS.BAD_INPUT_SQL, 
		parser_error: sqlInputValidationResult.errors, ...CONSTANTS.FALSE_RESULT};

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT,
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse].driver.module}`;
	let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
	const response = await aiLibrary.process({request: jsonReq.request, dbfrom: SUPPORTED_DBS[jsonReq.dbfrom].label, 
		dbto: SUPPORTED_DBS[jsonReq.dbto].label}, 
		`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${await _getPromptFile(jsonReq.request, jsonReq.dbfrom, jsonReq.dbto)}`, 
		aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
		dblayer.logUsage(jsonReq.id, response.metric_cost, aiModelToUse);
		const sql = response.airesponse; const validationResult = jsonReq.skipvalidation ? {isOK:true} :
			await sqlvalidator.validate(sql, jsonReq.dbto, undefined, jsonReq.use_simple_validator);
		return {sql, reason: REASONS.OK, possible_error: validationResult.isOK?undefined:true, 
			parser_error: validationResult.isOK?undefined:validationResult.errors, ...CONSTANTS.TRUE_RESULT};
	}
}

const _isStoredProcedure = sql => sql.match(/create[' '\t]+procedure/i);

const _getPromptFile = async (sql, dbfrom, dbto) => {
	const dbmappings = await _getDBMappings();
	return _isStoredProcedure(sql) ? 
		(dbmappings[`${dbfrom}_${dbto}`]?.promptfile_storedproc || dbmappings[`${dbfrom}_*`]?.promptfile_storedproc ||
			dbmappings[`*_${dbto}`]?.promptfile_storedproc || dbmappings[DEFAULT]?.promptfile_storedproc) :
		(dbmappings[`${dbfrom}_${dbto}`]?.promptfile_sql || dbmappings[`${dbfrom}_*`]?.promptfile_sql ||
			dbmappings[`*_${dbto}`]?.promptfile_sql || dbmappings[DEFAULT]?.promptfile_sql);
}

const _getDBMappings = async _ => {
	if (DEBUG_MODE) return JSON.parse(await fspromises.readFile(`${NEURANET_CONSTANTS.CONFDIR}/dbmappings.json`)).mappings;
	else return DB_MAPPINGS;
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.request && jsonReq.dbfrom && jsonReq.dbto &&
	Object.keys(SUPPORTED_DBS).includes(jsonReq.dbfrom) && Object.keys(SUPPORTED_DBS).includes(jsonReq.dbto));