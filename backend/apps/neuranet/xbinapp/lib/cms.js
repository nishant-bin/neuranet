/** 
 * Handles CMS root file system.
 * (C) 2020 TekMonks. All rights reserved.
 */
const fs = require("fs");
const path = require("path");
const fspromises = fs.promises;
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;
const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);
const register = require(`${LOGINAPP_CONSTANTS.API_DIR}/register.js`);
const updateuser = require(`${LOGINAPP_CONSTANTS.API_DIR}/updateuser.js`);
const loginappAPIKeyChecker = require(`${LOGINAPP_CONSTANTS.LIB_DIR}/loginappAPIKeyChecker.js`);

const DEFAULT_MAX_PATH_LENGTH = 50, CMSPATH_MODIFIERS = [], SAFE_CMS_PATHS = [];

exports.init = _ => {
	updateuser.addIDChangeListener(async (oldID, newID, org) => {	// ID changes listener
		const oldPath = _getPathForIDAndOrg(oldID, org), newPath = _getPathForIDAndOrg(newID, org);
		try {
			if (!await utils.rmrf(newPath)) throw `Can't access or delete path ${newPath}`;	// remove existing newPath folder, if it exists, as this ID is taking it over
			await fspromises.rename(oldPath, newPath); 
			LOG.info(`Renamed home folder for ID ${oldID} who is changing their ID to new ID ${newID} from ${oldPath} to ${newPath}.`); return true;
		} catch (err) {
			LOG.error(`Error renaming home folder for ID ${oldID} who is changing their ID to new ID ${newID}. Error is ${err}.`);
			return false;
		}
	})

	register.addNewUserListener(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`, "initXbinPath");// ID registration listener
}

/**
 * @param {object} headersOrLoginIDAndOrg HTTP request headers or {xbin_id, xbin_org} object
 * @param {extraInfo} Extra info object for CMS root, if passed in
 * @returns The CMS root for this user.
 */
exports.getCMSRoot = async function(headersOrLoginIDAndOrg, extraInfo) {
	const headersOrLoginIDAndOrgIsHeaders = !(headersOrLoginIDAndOrg.xbin_org &&  headersOrLoginIDAndOrg.xbin_id);
	const loginID = headersOrLoginIDAndOrgIsHeaders ? login.getID(headersOrLoginIDAndOrg) : headersOrLoginIDAndOrg.xbin_id; 
	if (!loginID) throw "No login for CMS root"; 
	const org = headersOrLoginIDAndOrgIsHeaders ? (login.getOrg(headersOrLoginIDAndOrg)||"unknown") : headersOrLoginIDAndOrg.xbin_org;
	let cmsRootToReturn = _getPathForIDAndOrg(loginID, org);
	LOG.info(`CMS raw root located at ${cmsRootToReturn} for ID ${loginID}.`);
	if (CMSPATH_MODIFIERS.length && (!extraInfo?.rawRoot)) for (cmsPathModifier of CMSPATH_MODIFIERS) cmsRootToReturn = cmsPathModifier(cmsRootToReturn, loginID, org, extraInfo);
	cmsRootToReturn = path.resolve(cmsRootToReturn);
	LOG.info(`Located final CMS home as ${cmsRootToReturn} for id ${loginID} of org ${org}.`);

	if (!SAFE_CMS_PATHS[cmsRootToReturn]) try {	// ensure directory exists if we have not already done so
		await fspromises.access(cmsRootToReturn, fs.F_OK); SAFE_CMS_PATHS[cmsRootToReturn] = true; } catch (err) { 
			await fspromises.mkdir(cmsRootToReturn, {recursive: true}); SAFE_CMS_PATHS[cmsRootToReturn] = true; }
	
	return cmsRootToReturn;
}

/**
 * @param {object} headersOrLoginIDAndOrg HTTP request headers or {xbin_id, xbin_org} object
 * @param {string} fullpath The full path 
 * @param {extraInfo} Extra info object for CMS root, if passed in
 * @returns The CMS root relative path for this user, given a full path
 */
exports.getCMSRootRelativePath = async function(headersOrLoginIDAndOrg, fullpath, extraInfo) {
	const cmsroot = await exports.getCMSRoot(headersOrLoginIDAndOrg, extraInfo);
	const relativePath = path.relative(cmsroot, fullpath).replaceAll("\\", "/");
	return relativePath;
}

/**
 * @param {object} headersOrLoginIDAndOrg HTTP request headers or {xbin_id, xbin_org} object
 * @param {string} cmsPath The CMS path
 * @param {extraInfo} Extra info object for CMS root, if passed in
 * @returns The full path for this user, given a cms path
 */
exports.getFullPath = async function(headersOrLoginIDAndOrg, cmsPath, extraInfo) {
	const cmsroot = await exports.getCMSRoot(headersOrLoginIDAndOrg, extraInfo);
	const fullpath = path.resolve(`${cmsroot}/${cmsPath}`);
	return fullpath;
}

/**
 * Reinits the XBIN path for the given user. Delete all existing files.
 * @param {object} headersOrLoginIDAndOrg HTTP request headers or {xbin_id, xbin_org} object
 * @returns {boolean} true on success and false on failure
 */
exports.initXbinPath = async (headersOrLoginIDAndOrg) => {
	const home = await exports.getCMSRoot(headersOrLoginIDAndOrg, {rawRoot: true});
	try {await utils.rmrf(home); return true;} catch(err) {
			LOG.error(`Can't init the home folder for id ${result.id} for org ${result.org} as can't access or delete path ${home}. The error is ${err}.`);
			return false;
	}
}

/**
 * Returns ID of the user given headers or ID & ORG object
 * @param {object} headersOrLoginIDAndOrg HTTP request headers or {xbin_id, xbin_org} object
 * @returns User ID
 */
exports.getID = headersOrLoginIDAndOrg => headersOrLoginIDAndOrg.xbin_id || login.getID(headersOrLoginIDAndOrg);

/**
 * Returns ORG of the user given headers or ID & ORG object
 * @param {object} headersOrLoginIDAndOrg HTTP request headers or {xbin_id, xbin_org} object
 * @returns User ORG
 */
exports.getOrg = headersOrLoginIDAndOrg => headersOrLoginIDAndOrg.xbin_org || login.getOrg(headersOrLoginIDAndOrg);

/**
 * Ensures the path is secure for the given user to operate on.
 * @param {object} headersOrLoginIDAndOrg HTTP request headers or {xbin_id, xbin_org} object
 * @param {string} path The path to operate on
 * @returns {boolean} true on success, false on failure
 */
exports.isSecure = async (headersOrHeadersAndOrg, path) => {	// add domain check here to ensure ID and org domains are ok
	const isKeySecure = headersOrHeadersAndOrg.xbin_org && headersOrHeadersAndOrg.headers ? 
		await loginappAPIKeyChecker.isAPIKeySecure(headersOrHeadersAndOrg.headers, headersOrHeadersAndOrg.xbin_org) : true;
	return isKeySecure && XBIN_CONSTANTS.isSubdirectory(path, await this.getCMSRoot(headersOrHeadersAndOrg, {rawRoot: true}));
}

/**
 * Adds CMS path modifier 
 * @param {function} modifier The path modifier
 */
exports.addCMSPathModifier = modifier => CMSPATH_MODIFIERS.push(modifier);

/**
 * Removes CMS path modifier 
 * @param {function} modifier The path modifier
 */
exports.removeCMSPathModifier = modifier => CMSPATH_MODIFIERS.indexOf(modifier) ? CMSPATH_MODIFIERS.splice(CMSPATH_MODIFIERS.indexOf(modifier),1) : null;

const _getPathForIDAndOrg = (id, org) => `${XBIN_CONSTANTS.CONF.CMS_ROOT}/${_convertToPathFriendlyString(org.toLowerCase())}/${_convertToPathFriendlyString(id.toLowerCase())}`;

const _convertToPathFriendlyString = (s, maxPathLength=DEFAULT_MAX_PATH_LENGTH) => {
	let tentativeFilepath = encodeURIComponent(s);
	if (tentativeFilepath.endsWith(".")) tentativeFilepath = tentativeFilepath.substring(0,finalPath.length-1)+"%2E";
		
	if (tentativeFilepath.length > maxPathLength) {
		tentativeFilepath = tentativeFilepath + "." + Date.now();
		tentativeFilepath = tentativeFilepath.substring(tentativeFilepath.length-maxPathLength);
	}
	
	return tentativeFilepath;
}
