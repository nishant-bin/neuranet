/**
 * Indexes a new document into the backend vector store knowledge base. 
 * The DB id can be used to split the backend into multiple vector stores, 
 * thus, building multiple knowledge bases. Saves the incoming document to
 * a new UTF8 text file at <cms_root_for_the_user>/dynamic.
 * 
 * API Request
 *  filename - the document to ingest's filename
 *  data - the document to ingest's data
 *  encoding - the document to ingest's encoding - can be any valid nodejs Buffer 
 * 			   encoding, if not given then UTF-8 is assumed.
 *  id - the user's ID or the AI DB id
 *  org - the user's org
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false, on true it is set to 'ok'
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const uploadfile = require(`${LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS.API_DIR}/uploadfile.js`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"};

const DYNAMIC_FILES_FOLDER = "dynamic";

exports.doService = async (jsonReq, _servObject, _headers, _url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got index document request from ID ${jsonReq.id}. Incoming filename is ${jsonReq.filename}.`);

	const _areCMSPathsSame = (cmspath1, cmspath2) => 
		(utils.convertToUnixPathEndings("/"+cmspath1, true) == utils.convertToUnixPathEndings("/"+cmspath2, true));
	const cmsPath = `${DYNAMIC_FILES_FOLDER}/${jsonReq.filename}`;
	try {
		const aidbFileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, 
			message => { if (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED && 
				_areCMSPathsSame(message.cmspath, cmsPath)) resolve(message); }));
		if (!(await uploadfile.uploadFile(jsonReq.id, jsonReq.org, 
				Buffer.from(jsonReq.data, jsonReq.encoding||"utf8"), cmsPath, jsonReq.comment)).result) {
			LOG.error(`CMS error uploading document for request ${JSON.stringify(jsonReq)}`); 
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		}
		const aidbIngestionResult = await aidbFileProcessedPromise;
		if (!aidbIngestionResult.result) {
			LOG.error(`AI library error indexing document for request ${JSON.stringify(jsonReq)}`); 
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		} else {
			if (jsonReq.__forceDBFlush) await aidbfs.flush(jsonReq.id, jsonReq.org);
			return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
		}
	} catch (err) {
		LOG.error(`Unable to save the corresponding dynamic file into the CMS. Failure error is ${err}.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.filename && jsonReq.data && jsonReq.id && jsonReq.org);