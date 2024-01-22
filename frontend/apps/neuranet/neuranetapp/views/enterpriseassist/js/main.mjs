/** 
 * View main module for the Enterprise assistant view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const API_GET_EVENTS = "events", MODULE_PATH = util.getModulePath(import.meta), VIEW_PATH = util.resolveURL(`${MODULE_PATH}/../`);

let chatsessionID;

function initView(data) {
    const loginresponse = session.get(APP_CONSTANTS.LOGIN_RESPONSE), 
        isAdmin = session.get(APP_CONSTANTS.CURRENT_USERROLE).toString() == "admin";
    LOG.info(`The login response object is ${JSON.stringify(loginresponse)}`);
    window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME]||{}), enterprise_assist_main: main}; 
    data.VIEW_PATH = VIEW_PATH;
    data.show_ai_training = isAdmin;
    data.collapse_ai_training = false;
    data.shownotifications = {action: "monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME].enterprise_assist_main.getNotifications()"};
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

async function processAssistantResponse(result, _chatboxid, _aiappid) {
    if (!result) return {error: (await i18n.get("EnterpriseAssist_AIError")), ok: false}
    if (result.session_id) chatsessionID = result.session_id;  // save session ID so that backend can maintain session
    if ((!result.result) && (result.reason == "limit")) return {error: await i18n.get("ErrorConvertingAIQuotaLimit"), ok: false};

    // in case of no knowledge, allow the assistant to continue still, with the message that we have no knowledge to answer this particular prompt
    if ((!result.result) && (result.reason == "noknowledge")) return {ok: true, response: await i18n.get("EnterpriseAssist_ErrorNoKnowledge")};

    if (!result.result) return {error: await i18n.get("ChatAIError"), ok: false};

    const resultFinal = (await router.getMustache()).render(await i18n.get("EnterpriseAssist_ResponseTemplate"), 
        {response: result.response, metadatas: result.metadatas});

    return {ok: true, response: resultFinal};
}

const getAssistantRequest = (question, _chatboxid, aiappid) => {
    return {id: session.get(APP_CONSTANTS.USERID), org: session.get(APP_CONSTANTS.USERORG), question, 
        session_id: chatsessionID, aiappid};
}

export const main = {initView, getNotifications, processAssistantResponse, getAssistantRequest};