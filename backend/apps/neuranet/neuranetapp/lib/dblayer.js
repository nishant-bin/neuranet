/**
 * Database layer for the Neuranet app.
 * 
 * (C) 2022 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */

const path = require("path");
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const DB_PATH = path.resolve(`${NEURANET_CONSTANTS.DBDIR}/neuranet.db`);
const DB_CREATION_SQLS = require(`${NEURANET_CONSTANTS.DBDIR}/neuranetapp_dbschema.json`);
const db = require(`${CONSTANTS.LIBDIR}/db.js`).getDBDriver("sqlite", DB_PATH, DB_CREATION_SQLS);

const DEFAULT_VIEWS_ORG = NEURANET_CONSTANTS.DEFAULT_ORG, DB_CACHE = {};

exports.initDB = async _ => await db.init();

exports.getViewsForOrg = async org => {
	const query = "SELECT view FROM views WHERE org=? COLLATE NOCASE";
	const cachedValue = _getDBCache(query, [org]);
	if (cachedValue) return cachedValue;

	const defaultViews = _getDBCache(query, [DEFAULT_VIEWS_ORG]) || _flattenArray(
		await db.getQuery(query, [DEFAULT_VIEWS_ORG]), "view");
	if (!_getDBCache(query, [DEFAULT_VIEWS_ORG])) _setDBCache(query, [DEFAULT_VIEWS_ORG], defaultViews);

	const orgViews = await db.getQuery(query, [org]);
	const selectedViews = orgViews && orgViews.length > 0 ? _flattenArray(orgViews, "view") : defaultViews;
	if (orgViews && orgViews.length > 0) _setDBCache(query, [org], selectedViews);
	return selectedViews;
}

exports.setViewsForOrg = async (org, views) => {
	const transactions = []; for (const view of views) transactions.push({
		cmd: "INSERT INTO views (org, view) values (?,?)", params: [org, view]});
	const result = await db.runTransaction(transactions); 

	if (result) _setDBCache("SELECT view FROM views WHERE org=? COLLATE NOCASE", [org], views);

	return result;
}

exports.logUsage = async (id, usage, model) => db.runCmd("INSERT INTO usage (id, usage, model) values (?,?,?)",
	[id, usage, model]);

exports.getAIModelUsage = async (id, startTimestamp, endTimestamp, model) => {
	const usage = await db.getQuery("SELECT sum(usage) AS totaluse FROM usage WHERE timestamp >= ? AND timestamp <= ? AND id=? AND model=?",
		[startTimestamp, endTimestamp, id, model]);
	if ((!usage) || (!usage.length) || (!usage[0].totaluse)) {
		LOG.warn(`No usage found for ID ${id}, model ${model} between the timestamps ${startTimestamp} and ${endTimestamp}.`);
		return 0;
	} else try { return parseFloat(usage[0].totaluse); } catch (err) {LOG.error(`Error parsing usage ${usage[0].totaluse} for ID ${id}, model ${model} between the timestamps ${startTimestamp} and ${endTimestamp}, returning 0.`); return 0;}
} 

exports.getQuota = async (id, org) => {
	const _parseQuota = quota => { try { return parseFloat(quota[0].quota); } catch (err) { LOG.error(
		`Error parsing quota ${quota[0].quota} for ID ${id}.`); return -1; } }
	
	let quota; 
	
	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", [id, org]);
	if ((!quota) || (!quota.length)) LOG.warn(`No quota found for id ${id} under org ${org}.`); 

	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", 
		[NEURANET_CONSTANTS.DEFAULT_ID, org]);
	if ((!quota) || (!quota.length)) LOG.warn(`No default quota found for org ${org}.`); 
	else {LOG.warn(`Using default quota of ${quota[0].quota} for org ${org}.`); return _parseQuota(quota);}

	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", 
		[NEURANET_CONSTANTS.DEFAULT_ID, NEURANET_CONSTANTS.DEFAULT_ORG]);
	if ((!quota) || (!quota.length)) {LOG.error(`No default quota found at all.`); return -1;}
	else {LOG.warn(`Using default quota of ${quota[0].quota} for ${id}.`); return _parseQuota(quota);}
}

exports.getOrgSettings = async function(org) {
	const query = "SELECT settings FROM orgsettings WHERE org=? COLLATE NOCASE";
	const cachedValue = _getDBCache(query, [org]);
	if (cachedValue) return cachedValue;

	const orgSettings = await db.getQuery(query, [org]);
	if ((!orgSettings) || (!orgSettings.length)) {
		LOG.warn(`No org settings found for org ${org}.`);
		return {};
	} else { const settings = JSON.parse(orgSettings[0].settings); _setDBCache(query, [org], settings); return settings; }
}

exports.setOrgSettings = async function(org, settings) {
	const result = await db.runCmd("INSERT OR REPLACE INTO orgsettings (org, settings) VALUES (?,?)", 
		[org, JSON.stringify(settings)]);
	if (result) _setDBCache("SELECT settings FROM orgsettings WHERE org=? COLLATE NOCASE", [org], settings);
	return result;
}

const _setDBCache = (query, params, result) => DB_CACHE[_getQueryHash(query, params)] = utils.clone(result);
const _getDBCache = (query, params) => DB_CACHE[_getQueryHash(query, params)];
const _getQueryHash = (query, params) => utils.hashObject([query, ...params]);

function _flattenArray(results, columnName, functionToCall) { 
	if (!results) return [];
	const retArray = []; for (const result of results) retArray.push(
		functionToCall?functionToCall(result[columnName]):result[columnName]); return retArray;
}