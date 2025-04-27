/** 
 * View main module for the chat view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {session} from "/framework/js/session.mjs";

const MODULE_PATH = util.getModulePathFromURL(import.meta.url);
let chatsessionID;

function initView(data) {
    window.monkshu_env.apps[APP_CONSTANTS.APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.APP_NAME]||{}), chat_main: main}; 
    data.icons_refresh = `${MODULE_PATH}/../img/newchat`;
}

async function processChatResponse(result, _chatboxid) {
    if (!result) return {error: (await i18n.get("ChatAIError")), ok: false}
    if (result.session_id) chatsessionID = result.session_id;  // save session ID so that backend can maintain session
    if ((!result.result) && (result.reason == "limit")) return {error: (await i18n.get("ErrorConvertingAIQuotaLimit")), ok: false};
    if (!result.result) return {error: (await i18n.get("ChatAIError")), ok: false};
    return {ok: true, response: result.response};
}

function getChatRequest(question, files, _chatboxid, aiappid) {
    return {id: session.get(APP_CONSTANTS.USERID), org: session.get(APP_CONSTANTS.USERORG), question, files,
        session_id: chatsessionID, aiappid};
}

export const main = {initView, processChatResponse, getChatRequest};