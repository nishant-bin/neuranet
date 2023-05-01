/** 
 * (C) 2015 TekMonks. All rights reserved.
 * License: See enclosed license.txt file.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {securityguard} from "/framework/js/securityguard.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";
import {APP_CONSTANTS as AUTO_APP_CONSTANTS} from "./constants.mjs";

const init = async hostname => {
	window.monkshu_env.apps[AUTO_APP_CONSTANTS.APP_NAME] = {};

	const mustache = await router.getMustache();
	window.APP_CONSTANTS = JSON.parse(mustache.render(JSON.stringify(AUTO_APP_CONSTANTS), {hostname}));

	window.LOG = window.monkshu_env.frameworklibs.log;

	if (!session.get($$.MONKSHU_CONSTANTS.LANG_ID)) session.set($$.MONKSHU_CONSTANTS.LANG_ID, "en");

	securityguard.setPermissionsMap(APP_CONSTANTS.PERMISSIONS_MAP);
	securityguard.setCurrentRole(securityguard.getCurrentRole() || APP_CONSTANTS.GUEST_ROLE);

	apiman.registerAPIKeys(APP_CONSTANTS.API_KEYS, APP_CONSTANTS.KEY_HEADER); 
	const API_GETREMOTELOG = APP_CONSTANTS.API_PATH+"/getremotelog", API_REMOTELOG = APP_CONSTANTS.API_PATH+"/log";
	const remoteLogResponse = (await apiman.rest(API_GETREMOTELOG, "GET")), remoteLogFlag = remoteLogResponse?remoteLogResponse.remote_log:false;
	LOG.setRemote(remoteLogFlag, API_REMOTELOG);

	const embeddedAppName = APP_CONSTANTS.EMBEDDED_APP_NAME?APP_CONSTANTS.EMBEDDED_APP_NAME.trim():undefined;
    if (embeddedAppName) i18n.addPath(`${APP_CONSTANTS.APP_PATH}/${embeddedAppName}`);
}

const main = async (desiredURL, desiredData) => {
	await _addPageLoadInterceptors(); await _readConfig(); await _registerComponents();
	const decodedURL = new URL(desiredURL || router.decodeURL(window.location.href)), justURL = util.baseURL(decodedURL);

	if (justURL == APP_CONSTANTS.INDEX_HTML) router.loadPage(APP_CONSTANTS.REGISTER_HTML);
	else if (securityguard.isAllowed(justURL)) {
		if (router.getLastSessionURL() && (decodedURL.toString() == router.getLastSessionURL().toString())) router.reload();
		else router.loadPage(decodedURL.href, desiredData);
	} else router.loadPage(APP_CONSTANTS.REGISTER_HTML);
}

const interceptPageLoadData = _ => router.addOnLoadPageData("*", async (data, _url) => {
	data.APP_CONSTANTS = APP_CONSTANTS; 
	data.headers = await $$.requireText(APP_CONSTANTS.CONF_PATH+"/headers.html");
});

async function _readConfig() {
	const conf = await $$.requireJSON(`${APP_CONSTANTS.CONF_PATH}/app.json`);
	for (const key of Object.keys(conf)) APP_CONSTANTS[key] = conf[key];

	// merge embedded app's app.json overiding the loginapp's app.json if needed.
	let confEmbedded = {}; if (APP_CONSTANTS.EMBEDDED_APP_NAME) try{ confEmbedded = await $$.requireJSON(
		`${APP_CONSTANTS.APP_PATH}/${APP_CONSTANTS.EMBEDDED_APP_NAME}/conf/app.json`) } catch(err) {
			LOG.warn(`Missing or unreadable app.json for the embedded app. The error is ${err}.`);
		};
	for (const [key, value] of Object.entries(confEmbedded)) 
		if (APP_CONSTANTS[key] && Array.isArray(APP_CONSTANTS[key])) APP_CONSTANTS[key] = 
			[...APP_CONSTANTS[key], ...(Array.isArray(value)?value:[value])]; 	// merge arrays
		else if ((typeof APP_CONSTANTS[key] === "object") && (typeof value === "object")) 
			APP_CONSTANTS[key]  = {...APP_CONSTANTS[key], ...value};
		else APP_CONSTANTS[key] = value;
}

const _registerComponents = async _ => { for (const component of APP_CONSTANTS.COMPONENTS) 
	await import(`${APP_CONSTANTS.APP_PATH}/${component}/${component.substring(component.lastIndexOf("/")+1)}.mjs`); }

async function _addPageLoadInterceptors() {
	const interceptors = await(await fetch(`${APP_CONSTANTS.CONF_PATH}/pageLoadInterceptors.json`)).json();
	for (const interceptor of interceptors) {
		const modulePath = interceptor.module, functionName = interceptor.function;
		let module = await import(`${APP_CONSTANTS.LOGINAPP_PATH}/${modulePath}`); module = module[Object.keys(module)[0]];
		(module[functionName])();
	}
}

export const application = {init, main, interceptPageLoadData};