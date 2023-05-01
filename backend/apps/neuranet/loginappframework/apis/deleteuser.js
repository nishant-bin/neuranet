/**
 * Logs a user in. 
 * (C) 2015 TekMonks. All rights reserved.
 */
const userid = require(`${APP_CONSTANTS.LIB_DIR}/userid.js`);

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}
	
	LOG.debug(`Got delete user request for ID ${jsonReq.userid} from admin ID ${jsonReq.id}`);

	const result = await userid.deleteUser(jsonReq.userid);

	if (result.result) LOG.info(`User ${jsonReq.userid} deleted by admin with ID ${jsonReq.id}.`); 
	else LOG.error(`Unable to delete user with ID: ${jsonReq.userid}, requested by admin with ID ${jsonReq.id}.`);

	return result;
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.userid);
