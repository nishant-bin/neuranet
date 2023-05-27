/**
 * Indexes a new document into the backend vector store knowledge base. 
 * The DB id can be used to split the backend into multiple vector stores, 
 * thus, building multiple knowledge bases. Saves the incoming document to
 * a new UTF8 text file at <cmd_root_for_the_user>/dynamic_files path.
 * 
 * API Request
 *  document - the document to ingest
 *  metadata - the document metadata
 *  model - (optional) the AI model to use to create the embeddings
 *  return_vectors - (optional) whether to return the ingested vectors,
 *                   to avoid unnecessary network traffic best is to set
 *                   this to false or don't send it at all
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const uploadfile = require(`${XBIN_CONSTANTS.API_DIR}/uploadfile.js`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"};

const DYNAMIC_FILES_FOLDER = "dynamic_files", SUMMARIZATION_CHARACTERS = 10;

exports.doService = async (jsonReq, _servObject, headers, _url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got index document request from ID ${jsonReq.id}. Incoming request metadata is ${JSON.stringify(jsonReq.metadata)}`);

	if (!(await quota.checkQuota(jsonReq.id))) {
		LOG.error(`Disallowing the API call, as the user ${jsonReq.id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const id = cms.getID(headers), org = cms.getOrg(headers);
	if (!(id && org)) {LOG.error(`Disallowing request, as ID and ORG could not be identified from the request.`); return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};}

	const folderForDynamicDocuments = `${cms.getCMSRoot(headers)}/${DYNAMIC_FILES_FOLDER}`; 
	const saveFilePath = `${folderForDynamicDocuments}/${jsonReq.document.substring(0, jsonReq.document.length < 
		SUMMARIZATION_CHARACTERS ? jsonReq.document.length : SUMMARIZATION_CHARACTERS)}_${Date.now()}.txt`;
	try {
		await uploadfile.createFolder(folderForDynamicDocuments);
		await uploadfile.writeUTF8File(headers, saveFilePath, jsonReq.document);
	} catch (err) {
		LOG.error(`Unable to save the corresponding dynamic file into the CMS. Failure error is ${err}.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}
	
	const fileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
        if (message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED && message.path == saveFilePath) resolve(message);
    }));
    blackboard.publish(XBIN_CONSTANTS.XBINEVENT, {type: XBIN_CONSTANTS.EVENTS.FILE_CREATED, path: saveFilePath, 
        ip: utils.getLocalIPs()[0], id, org, return_vectors: jsonReq.return_vectors?true:false});
    const result = await fileProcessedPromise;

	if (!result.result) {
		LOG.error(`AI library error indexing document for request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else return {vectors: jsonReq.return_vectors ? result.vectors : [], reason: REASONS.OK, 
		...CONSTANTS.TRUE_RESULT};
}

const validateRequest = jsonReq => (jsonReq && jsonReq.document && jsonReq.metadata);