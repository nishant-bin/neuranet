/* 
 * (C) 2020 TekMonks. All rights reserved.
 */
const path = require("path");
const fspromises = require("fs").promises;
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const db = require(`${XBIN_CONSTANTS.LIB_DIR}/xbindb.js`).getDB();
const uploadfile = require(`${XBIN_CONSTANTS.API_DIR}/uploadfile.js`);

exports.doService = async (jsonReq, _, headers) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}
	
	LOG.debug("Got renamefile request for path: " + jsonReq.old);

	const oldPath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.old}`), newPath = path.resolve(`${await cms.getCMSRoot(headers)}/${jsonReq.new}`);
	if (!await cms.isSecure(headers, oldPath)) {LOG.error(`Path security validation failure: ${jsonReq.old}`); return CONSTANTS.FALSE_RESULT;}
	if (!await cms.isSecure(headers, newPath)) {LOG.error(`Path security validation failure: ${jsonReq.new}`); return CONSTANTS.FALSE_RESULT;}
	if (oldPath == newPath) {	// sanity check
		LOG.warn(`Rename requested from and to the same file paths. Ignoring. From is ${oldPath} and to is the same.`);
		return CONSTANTS.TRUE_RESULT;
	}

	const _renameFile = async (oldpath, newpath, remotepathNew) => {
		await fspromises.rename(oldpath, newpath);
		await uploadfile.renameDiskFileMetadata(oldpath, newpath,  remotepathNew);
		await db.runCmd("UPDATE shares SET fullpath = ? WHERE fullpath = ?", [newpath, oldpath]);	// update shares
	}

	try {
		await _renameFile(oldPath, newPath, jsonReq.new);
		const newStats = await uploadfile.getFileStats(newPath); 
		if (newStats.xbintype == XBIN_CONSTANTS.XBIN_FOLDER) {	// for folders we must update metadata remotepaths
			await utils.walkFolder(newPath, async (fullpath, _stats, relativePath) => {
				if (XBIN_CONSTANTS.XBIN_IGNORE_PATH_SUFFIXES.includes(path.extname(fullpath))) return;
				const remotePathNew = jsonReq.new+"/"+relativePath, oldfullpath = path.resolve(oldPath+"/"+relativePath);
				await uploadfile.updateDiskFileMetadataRemotePaths(fullpath, remotePathNew);
				await db.runCmd("UPDATE shares SET fullpath = ? WHERE fullpath = ?", [fullpath, oldfullpath]);	// update shares
			}, true);
		}

		blackboard.publish(XBIN_CONSTANTS.XBINEVENT, {type: XBIN_CONSTANTS.EVENTS.FILE_RENAMED, oldPath, newPath, 
			ip: utils.getLocalIPs()[0], isDirectory: newStats.xbintype == XBIN_CONSTANTS.XBIN_FOLDER, 
			id: cms.getID(headers), org: cms.getOrg(headers)});

        return CONSTANTS.TRUE_RESULT;
	} catch (err) {LOG.error(`Error renaming  path: ${oldPath}, error is: ${err}`); return CONSTANTS.FALSE_RESULT;}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.old && jsonReq.new);
