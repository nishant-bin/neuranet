/* 
 * (C) 2020 TekMonks. All rights reserved.
 */
const path = require("path");
const fspromises = require("fs").promises;
const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const db = require(`${XBIN_CONSTANTS.LIB_DIR}/xbindb.js`).getDB();
const uploadfile = require(`${XBIN_CONSTANTS.API_DIR}/uploadfile.js`);

exports.doService = async (jsonReq, _, headers) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}
	
	LOG.debug("Got deletefile request for path: " + jsonReq.path);

	const fullpath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.path}`);
	if (!await cms.isSecure(headers, fullpath)) {LOG.error(`Path security validation failure: ${jsonReq.path}`); return CONSTANTS.FALSE_RESULT;}

	const ip = utils.getLocalIPs()[0], id = cms.getID(headers), org = cms.getOrg(headers);

	try {
		await rmrf(fullpath, id, org, ip); 
		return CONSTANTS.TRUE_RESULT;
	} catch (err) {LOG.error(`Error deleting  path: ${fullpath}, error is: ${err}`); return CONSTANTS.FALSE_RESULT;}
}

async function rmrf(path, id, org, ip) {
	const _deleteFile = async path => {
		await unlinkFileAndRemoveFromDB(path); 
		blackboard.publish(XBIN_CONSTANTS.XBINEVENT, {type: XBIN_CONSTANTS.EVENTS.FILE_DELETED, path, id, org, ip});
	}

	if ((await fspromises.stat(path)).isFile()) { await _deleteFile(path); return; }

	const entries = await fspromises.readdir(path);
	for (const entry of entries) {
		const stats = await uploadfile.getFileStats(`${path}/${entry}`);
		if (stats.xbintype == XBIN_CONSTANTS.XBIN_FILE) await _deleteFile(`${path}/${entry}`); 
		else if (stats.xbintype == XBIN_CONSTANTS.XBIN_FOLDER) await rmrf(`${path}/${entry}`);
	}
	await fspromises.rmdir(path); try {await uploadfile.deleteDiskFileMetadata(path);} catch (err) {};
}

async function unlinkFileAndRemoveFromDB(path) {
	await db.runCmd("DELETE FROM shares WHERE fullpath = ?", [path]);	
	await fspromises.unlink(path); try {await uploadfile.deleteDiskFileMetadata(path);} catch (err) {};
}

const validateRequest = jsonReq => (jsonReq && jsonReq.path);