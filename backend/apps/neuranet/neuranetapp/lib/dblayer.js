/**
 * Database layer for the Neuranet app.
 * (C) 2022 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */

const path = require("path");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const DB_PATH = path.resolve(`${NEURANET_CONSTANTS.DBDIR}/neuranet.db`);
const DB_CREATION_SQLS = require(`${NEURANET_CONSTANTS.DBDIR}/neuranetapp_dbschema.json`);
const db = require(`${CONSTANTS.LIBDIR}/db.js`).getDBDriver("sqlite", DB_PATH, DB_CREATION_SQLS);

const DEFAULT_VIEWS_ORG = "_org_neuranet_defaultorg_";

exports.initDB = async _ => await db.init();

exports.getViewsForOrg = async org => {
	const defaultViews = await db.getQuery("SELECT view FROM views WHERE org=? COLLATE NOCASE", [DEFAULT_VIEWS_ORG]);
	const orgViews = await db.getQuery("SELECT view FROM views WHERE org=? COLLATE NOCASE", [org]);

	const selectedViews = orgViews && orgViews.length > 0 ? _flattenArray(orgViews, "view") : 
		_flattenArray(defaultViews, "view");

	return selectedViews;
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

	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", ["_default_", org]);
	if ((!quota) || (!quota.length)) LOG.warn(`No default quota found for org ${org}.`); 
	else {LOG.warn(`Using default quota of ${quota[0].quota} for org ${org}.`); return _parseQuota(quota);}

	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", ["_default_", "_org_neuranet_defaultorg_"]);
	if ((!quota) || (!quota.length)) {LOG.error(`No default quota found at all.`); return -1;}
	else {LOG.warn(`Using default quota of ${quota[0].quota} for ${id}.`); return _parseQuota(quota);}
}

exports.getAIFederationModeForOrg = async function(org) {
	const settings = await getOrgSettings(org);
	return settings.aifederationmode;
}

exports.getOrgSettings = async function(org) {
	const orgSettings = await db.getQuery("SELECT settings from orgsettings where org=? COLLATE NOCASE", [org]);
	if ((!orgSettings) || (!orgSettings.length)) {
		LOG.warn(`No org settings found for org ${org}.`);
		return {};
	} else return JSON.parse(orgSettings[0]);
}

function _flattenArray(results, columnName, functionToCall) { 
	if (!results) return [];
	const retArray = []; for (const result of results) retArray.push(
		functionToCall?functionToCall(result[columnName]):result[columnName]); return retArray;
}