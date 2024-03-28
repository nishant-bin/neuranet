/**
 * Indexes a new document into the backend document knowledge base. 
 * The DB id can be used to split the backend into multiple vector stores, 
 * thus, building multiple knowledge bases. Saves the incoming document to
 * a new UTF8 text file at <cms_root_for_the_user>/dynamic.
 * 
 * API Request
 *  filename - the document to ingest's filename
 *  data - the document to ingest's data
 *  id - the user's ID 
 *  org - the user's org
 *  aiappid - the AI app ID for the user
 *  cmspath - Optional: the path to the CMS file entry, if skipped the file is uploaded to "uploads" folder
 *  encoding - Optional: the document to ingest's encoding - can be any valid nodejs Buffer 
 * 			   encoding, if not given then UTF-8 is assumed.
 *  comment - Optional: file's comment for the CMS
 *  start_transaction - Optional: If used indicates a start to a mass load transaction
 *  stop_transaction - Optional: If used indicates a stop to a mass load transaction
 *  continue_transaction - Optional: If used indicates a continuation of a mass load transaction
 *  __forceDBFlush - Optional: if true, forces the DBs to flush to the filesystem
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
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);
const fileindexer = require(`${NEURANET_CONSTANTS.LIBDIR}/fileindexer.js`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"};

const DEFAULT_DYNAMIC_FILES_FOLDER = "uploads";

exports.DEFAULT_DYNAMIC_FILES_FOLDER = DEFAULT_DYNAMIC_FILES_FOLDER;

exports.doService = async (jsonReq, _servObject, _headers, _url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	const {id, org, aiappid, filename, cmspath, encoding, data, comment, __forceDBFlush} = jsonReq;
	LOG.debug(`Got index document request from ID ${id} and org ${org}. Incoming filename is ${cmspath||"undefined"}/${filename}.`);

	const _areCMSPathsSame = (cmspath1, cmspath2) => 
		(utils.convertToUnixPathEndings("/"+cmspath1, true) == utils.convertToUnixPathEndings("/"+cmspath2, true));
	const aiappThis = await aiapp.getAIApp(id, org, aiappid), 
		finalCMSPath = `${cmspath||aiappThis.api_uploads_cms_path||exports.DEFAULT_DYNAMIC_FILES_FOLDER}/${jsonReq.filename}`;
	try {
		const aidbFileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, 
			message => { if (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED && 
				_areCMSPathsSame(message.cmspath, finalCMSPath)) resolve(message); }));
		const extrainfo = brainhandler.createExtraInfo(id, org, aiappid);
		if (!await fileindexer.addFileToCMSRepository(id, org, Buffer.from(data, encoding||"utf8"), 
			finalCMSPath, comment, extrainfo)) {

			LOG.error(`CMS error uploading document for request id ${id} org ${org} and file ${finalCMSPath}/${filename}`); 
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		}
		const aidbIngestionResult = await aidbFileProcessedPromise;
		if (!aidbIngestionResult.result) {
			LOG.error(`AI library error indexing document for request id ${id} org ${org} and file ${finalCMSPath}/${filename}.`); 
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		} else {
			LOG.error(`Successful indexing document for request id ${id} org ${org} and file ${finalCMSPath}/${filename}`); 
			if (__forceDBFlush) await aidbfs.flush(id, org, await brainhandler.getAppID(id, org, extrainfo));
			return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
		}
	} catch (err) {
		LOG.error(`Unable to save the corresponding dynamic file into the CMS. Failure error is ${err}.`, true);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.filename && jsonReq.data && jsonReq.id && jsonReq.org && 
	jsonReq.aiappid);