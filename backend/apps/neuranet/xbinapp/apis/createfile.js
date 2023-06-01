/** 
 * (C) 2020 TekMonks. All rights reserved.
 */
const path = require("path");
const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const uploadfile = require(`${XBIN_CONSTANTS.API_DIR}/uploadfile.js`);

exports.doService = async (jsonReq, _, headers) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}
	
	LOG.debug("Got createfile request for path: " + jsonReq.path);

	try {
		const fullpath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.path}`);
		if (!await cms.isSecure(headers, fullpath)) {LOG.error(`Path security validation failure: ${jsonReq.path}`); return CONSTANTS.FALSE_RESULT;}

		if (jsonReq.isDirectory && jsonReq.isDirectory != "false") await uploadfile.createFolder(headers, jsonReq.path);
		else await uploadfile.writeUTF8File(headers, jsonReq.path, Buffer.from('', 'utf8'));

		blackboard.publish(XBIN_CONSTANTS.XBINEVENT, {type: XBIN_CONSTANTS.EVENTS.FILE_CREATED, path: fullpath, 
			ip: utils.getLocalIPs()[0], isDirectory: (jsonReq.isDirectory && jsonReq.isDirectory != "false"),
			id: cms.getID(headers), org: cms.getOrg(headers)});

        return CONSTANTS.TRUE_RESULT;
	} catch (err) {LOG.error(`Error creating  path: ${fullpath}, error is: ${err}.`); return CONSTANTS.FALSE_RESULT;}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.path);
