/** 
 * A user manager component. Needs corresponding backend api.
 * (C) 2021 TekMonks. All rights reserved.
 * License: See enclosed license file.
 */
import {util} from "/framework/js/util.mjs";
import {i18n} from "/framework/js/i18n.mjs";
import {router} from "/framework/js/router.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";
import {monkshu_component} from "/framework/js/monkshu_component.mjs";

const COMPONENT_PATH = util.getModulePath(import.meta), API_CONVERT = "convertsql";
let conf, mustache;

async function elementConnected(element) {
	conf = await $$.requireJSON(`${COMPONENT_PATH}/conf/conf.json`); mustache = await router.getMustache();

	const data = {CONF: conf, COMPONENT_PATH};
	neuranet_sql.setDataByHost(element, data);
}

async function convert(elementImg) {
	const shadowRoot = neuranet_sql.getShadowRootByContainedElement(elementImg), host = neuranet_sql.getHostElement(elementImg);
	const texteditorRequest = shadowRoot.querySelector("text-editor#sourcesql"), 
		texteditorResponse = shadowRoot.querySelector("text-editor#targetsql"), requestSQL = texteditorRequest.value,
		dbfrom = conf.DB_BACKEND_ID_MAPPINGS[shadowRoot.querySelector("select#sourcedb").value], 
		dbto = conf.DB_BACKEND_ID_MAPPINGS[shadowRoot.querySelector("select#targetdb").value],
		validate = shadowRoot.querySelector("input#validatesql").checked,
		userid = host.getAttribute("user");
	
	if (requestSQL.trim() == "") {_showError(await i18n.get("NothingToConvert")); return;}
	texteditorResponse.value = ""; elementImg.src = `${COMPONENT_PATH}/img/spinner.svg`;
	const convertedResponse = dbfrom == dbto ? {sql: requestSQL, result: true} : await apiman.rest(
		`${host.getAttribute("backendurl")}/${API_CONVERT}`, "POST", {request: requestSQL, dbfrom, dbto, id: userid, 
			skipvalidation: validate, use_simple_validator: conf.SIMPLE_VALIDATOR}, true);
	elementImg.src = `${COMPONENT_PATH}/img/bot.svg`;

	if (!convertedResponse) {LOG.error("Conversion failed due to backend internal issues."); _showError(await i18n.get("InternalErrorConverting")); return;}
	if (!convertedResponse.result) {
		let key = "Internal"; switch (convertedResponse.reason) {
			case "internal": key = "Internal"; break;
			case "badmodel": key = "BadAIModel"; break;
			case "badrequest": key = "BadAPIRequest"; break;
			case "badinputsql": key = "BadInputSQL"; break;
			default: key = "Internal"; break;
		}
		const err = mustache.render(await i18n.get(`ErrorConverting${key}`), convertedResponse.parser_error?.[0] ?
			{ message: convertedResponse.parser_error[0].error, line: convertedResponse.parser_error[0].line, 
				column: convertedResponse.parser_error[0].column } : {});
		LOG.error(err); if (key == "BadInputSQL") _showErrorNoCenter(err); else _showError(err); return;
	}

	let sqlErrHeader = ""; if (convertedResponse.possibleError) {	// set the SQL with an error warning if needed
		err = mustache.render(await i18n.get("PossibleErrorConverting"), convertedResponse.parser_error ?
		{ message: convertedResponse.parser_error[0].error, line: convertedResponse.parser_error[0].line, 
			column: convertedResponse.parser_error[0].column } : {});
	}; texteditorResponse.value = sqlErrHeader+convertedResponse.sql;
}

const _showError = async error => { await monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/error.html`, 
	true, false, {error, CONF:conf}, "dialog", []); monkshu_env.components['dialog-box'].hideDialog("dialog"); }
const _showErrorNoCenter = async error => { await monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/errornocenter.html`, 
	true, false, {error, CONF:conf}, "dialog", []); monkshu_env.components['dialog-box'].hideDialog("dialog"); }
const _showMessage = async message => { await monkshu_env.components['dialog-box'].showDialog(`${COMPONENT_PATH}/dialogs/message.html`, 
	true, false, {message, CONF:conf}, "dialog", []); monkshu_env.components['dialog-box'].hideDialog("dialog"); }

export const neuranet_sql = {trueWebComponentMode: true, elementConnected, convert}
monkshu_component.register("neuranet-sql", `${COMPONENT_PATH}/neuranet-sql.html`, neuranet_sql);