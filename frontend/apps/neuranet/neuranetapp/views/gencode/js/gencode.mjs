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

const MODULE_PATH = util.getModulePath(import.meta), API_CONVERT = "convertcode", 
	API_CONVERT_CHAIN = "convertcodechain", VIEW_PATH = util.resolveURL(`${MODULE_PATH}/../`),
	AGI_CHAIN_BOUNDARY = "------------ AGI CHAIN ";
let conf, mainModule;

async function convert(elementImg) {
	const texteditorRequest = document.querySelector("text-editor#sourcelang"), 
		texteditorResponse = document.querySelector("text-editor#targetlang"), requestCode = texteditorRequest.value,
		langfrom = conf.LANG_BACKEND_ID_MAPPINGS[document.querySelector("select#sourcelang").value], 
		langto = conf.LANG_BACKEND_ID_MAPPINGS[document.querySelector("select#targetlang").value],
		userid = session.get(APP_CONSTANTS.USERID), 
		isAGIChain = document.querySelector("input#agichain").checked;
	
	if (requestCode.trim() == "") {mainModule.showMessage(await i18n.get("NothingToConvert")); return;}
	texteditorResponse.value = ""; elementImg.src = `${VIEW_PATH}/img/spinner.svg`; texteditorRequest.readOnly = true; 
	const orgImgOnclick = elementImg.onclick; elementImg.onclick = _ => {};
	const apirequest = {request: isAGIChain?_getRequestChain(requestCode):requestCode, langfrom, langto, id: userid}
	let previousPartialResponse;
	const convertedResponse = langfrom == langto ? {code: requestCode, result: true} : 
		await _getPolledResponse(`${APP_CONSTANTS.API_PATH}/${isAGIChain?API_CONVERT_CHAIN:API_CONVERT}`, 
				"POST", apirequest, {id: userid}, [true], undefined, partialResponse => { 
			if (partialResponse.code && (partialResponse.code != previousPartialResponse)) {
				texteditorResponse.value = partialResponse.code; monkshu_env.components["text-editor"].scrollToBottom("targetlang"); 
				previousPartialResponse = partialResponse.code;
			} 
		});
	elementImg.src = `${VIEW_PATH}/img/bot.svg`; elementImg.onclick = orgImgOnclick; texteditorRequest.readOnly = false; 

    const mustache = await router.getMustache();
	if (!convertedResponse) {LOG.error("Conversion failed due to backend internal issues."); mainModule.showMessage(await i18n.get("InternalErrorConverting")); return;}
	if (!convertedResponse.result) {
		let key = "Internal"; switch (convertedResponse.reason) {
			case "internal": key = "Internal"; break;
			case "badmodel": key = "BadAIModel"; break;
			case "badrequest": key = "BadAPIRequest"; break;
			case "badinputcode": key = "BadInputCode"; break;
			case "limit": key = "AIQuotaLimit"; break;
			default: key = "Internal"; break;
		}
		const err = mustache.render(await i18n.get(`ErrorConverting${key}`), convertedResponse.parser_error?.[0] ?
			{ message: convertedResponse.parser_error[0].error, line: convertedResponse.parser_error[0].line, 
				column: convertedResponse.parser_error[0].column } : {});
		LOG.error(err); mainModule.showMessage(err); return;
	}

	let codeResponseErrHeader; if (convertedResponse.possible_error) {	// set the code with an error warning if needed
        codeResponseErrHeader = mustache.render(await i18n.get("PossibleErrorConvertingCode"), convertedResponse.parser_error ?
		    { message: convertedResponse.parser_error[0].error, line: convertedResponse.parser_error[0].line, 
			    column: convertedResponse.parser_error[0].column } : {}) + "\n\n";
	}; texteditorResponse.value = (convertedResponse.possible_error?codeResponseErrHeader:"")+convertedResponse.code;
	monkshu_env.components["text-editor"].scrollToBottom("targetlang"); 
}

async function init(data, main) {
    const confPath = `${VIEW_PATH}/conf/conf.json`; conf = await $$.requireJSON(confPath);
    data.CONF = {...conf}; mainModule = main;
}

function _getRequestChain(request) {
	const rawChains = request.trim().split(AGI_CHAIN_BOUNDARY);
	const requestChain = []; for (const rawChain of rawChains) {
		const context = rawChain.substring(0, rawChain.indexOf("\n")).trim().toLowerCase(), 
			data = rawChain.substring(rawChain.indexOf("\n")+1).trim();
		if (context && data) requestChain.push({context, data});
	}
	return requestChain;
}

async function _getPolledResponse(url, requestType, initialRequest, waitRequest, apimanOptions, timeout, streamer) {	
	return new Promise(async resolve => {
		const startTime = Date.now();
		const initialResponse = await apiman.rest(url, requestType, initialRequest, ...apimanOptions);
		if ((!initialResponse) || (initialResponse.result != "wait") || (!initialResponse.requestid)) {
			resolve(initialResponse); return; }

		// only if we get a requestid back then we are inside an async API wait loop
		const timer = setInterval(async _=>{
			if (timeout && ((Date.now() - startTime) >= timeout)) {
				clearInterval(timer); LOG.error(`Async API ${url} timedout after ${timeout} milliseconds.`); 
				resolve(null); return; 
			}

			const waitResponse = await apiman.rest(url, requestType, 
				{...waitRequest, requestid: initialResponse.requestid}, ...apimanOptions);
			if ((!waitResponse) || (waitResponse.result != "wait") || (!initialResponse.requestid)) {
				clearInterval(timer); resolve(waitResponse); return; }
			else if (streamer) streamer(waitResponse);
		}, APP_CONSTANTS.ASYNC_API_POLL_WAIT);
	});
}

export const gencode = {convert, init};