/** 
 * View main module for the search view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const API_GET_EVENTS = "events", MODULE_PATH = util.getModulePath(import.meta),
    VIEW_PATH = util.resolveURL(`${MODULE_PATH}/../`), SESSION_OBJ_TEMPLATE = {"role": "user", "content": ""};

let chatsessionID;

function initView(data) {
    window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME]||{}), searchmain: main}; 
    data.VIEW_PATH = VIEW_PATH;
    data.shownotifications = {action: "monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME].searchmain.getNotifications()"};
}

async function getNotifications() {
    const id = session.get(APP_CONSTANTS.USERID), org = session.get(APP_CONSTANTS.USERORG);
    const events = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_GET_EVENTS}`, "GET", {id: id.toString(), 
        org: org.toString()}, true);
    if ((!events) || (!events.result)) LOG.error(`Error fetching events.`); 

    const eventsArray = []; if (events?.result) for (const event of Object.values(events.events)) 
        eventsArray.push({...event, success: event.result == true ? true : undefined, 
            error: event.result == true ? undefined : true, VIEW_PATH});
    
    const eventsTemplate = document.querySelector("#notificationstemplate"), eventsHTML = eventsTemplate.innerHTML,
        matches = /<!--([\s\S]+)-->/g.exec(eventsHTML), template = matches[1]; 
    const renderedEvents = (await router.getMustache()).render(template, await router.getPageData(undefined, 
        {events:eventsArray.length?eventsArray:undefined})); 
    return renderedEvents;
}

async function processChatResponse(result, _chatboxid) {
    if (!result) return {error: (await i18n.get("ChatAIError")), ok: false}
    if (result.session_id) chatsessionID = result.session_id;  // save session ID so that backend can maintain session
    if ((!result.result) && (result.reason == "limit")) return {error: await i18n.get("ErrorConvertingAIQuotaLimit"), ok: false};

    // in case of no knowledge, allow the chat to continue still, with the message that we have no knowledge to answer this particular prompt
    if ((!result.result) && (result.reason == "noknowledge")) return {ok: true, response: await i18n.get("EnterpriseSearch_ErrorNoKnowledge")};

    if (!result.result) return {error: await i18n.get("ChatAIError"), ok: false};

    return {ok: true, response: result.response};
}

const getChatRequest = (question, _chatboxid) => {
    return {id: session.get(APP_CONSTANTS.USERID), question, session_id: chatsessionID};
}

export const main = {initView, getNotifications, processChatResponse, getChatRequest};