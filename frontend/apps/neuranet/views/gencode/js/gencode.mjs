/** 
 * A user manager component. Needs corresponding backend api.
 * (C) 2021 TekMonks. All rights reserved.
 * License: See enclosed license file.
 */
import {util} from "/framework/js/util.mjs";
import {i18n} from "/framework/js/i18n.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const MODULE_PATH = util.getModulePath(import.meta), API_CONVERT = "convertcode";
let conf, mainModule;

async function convert(elementImg) {
	const texteditorRequest = document.querySelector("text-editor#sourcelang"), 
		texteditorResponse = document.querySelector("text-editor#targetlang"), requestCode = texteditorRequest.value,
		langfrom = conf.LANG_BACKEND_ID_MAPPINGS[document.querySelector("select#sourcelang").value], 
		langto = conf.LANG_BACKEND_ID_MAPPINGS[document.querySelector("select#targetlang").value],
		userid = session.get(APP_CONSTANTS.USERID);
	
	if (requestCode.trim() == "") {mainModule.showMessage(await i18n.get("NothingToConvert")); return;}
	texteditorResponse.value = ""; elementImg.src = `${MODULE_PATH}/img/spinner.svg`;
	const convertedResponse = langfrom == langto ? {code: requestCode, result: true} : await apiman.rest(
		`${host.getAttribute("backendurl")}/${API_CONVERT}`, "POST", {request: requestCode, langfrom, langto, 
            id: userid}, true);
	elementImg.src = `${MODULE_PATH}/img/bot.svg`;

    const mustache = await router.getMustache();
	if (!convertedResponse) {LOG.error("Conversion failed due to backend internal issues."); mainModule.showMessage(await i18n.get("InternalErrorConverting")); return;}
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
		LOG.error(err); mainModule.showMessage(err); return;
	}

	let codeResponseErrHeader = "// "; if (convertedResponse.possibleError) {	// set the code with an error warning if needed
        codeResponseErrHeader += mustache.render(await i18n.get("PossibleErrorConverting"), convertedResponse.parser_error ?
		    { message: convertedResponse.parser_error[0].error, line: convertedResponse.parser_error[0].line, 
			    column: convertedResponse.parser_error[0].column } : {});
	}; texteditorResponse.value = (convertedResponse.possibleError?codeResponseErrHeader:"")+convertedResponse.code;
}

async function init(data, main) {
    const confPath = util.resolveURL(`${MODULE_PATH}/../conf/conf.json`); conf = await $$.requireJSON(confPath);
    data.CONF = {...conf}; mainModule = main;
}

export const gencode = {convert, init};