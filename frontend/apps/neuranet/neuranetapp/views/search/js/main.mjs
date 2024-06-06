/** 
 * View main module for the search view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

let activeaiapp;

function initView(data) {
    const isAdmin = data.activeaiapp.is_user_appadmin||session.get(APP_CONSTANTS.CURRENT_USERROLE).toString() == "admin";
    window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME] = {
            ...(window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME]||{}), search_main: main}; 
    data.VIEW_PATH = data.view_path;
    data.show_ai_training = isAdmin;
    data.collapse_ai_training = false;
    data.extrainfo = {id: session.get(APP_CONSTANTS.USERID).toString(), 
        org: session.get(APP_CONSTANTS.USERORG).toString(), aiappid: data.activeaiapp.id, mode: "trainaiapp"};
    data.extrainfo_base64_json = util.stringToBase64(JSON.stringify(data.extrainfo));
    data.shownotifications = {action: "monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME].search_main.getNotifications()"};
    data.aiskipfolders_base64_json = data.activeaiapp.interface.skippable_file_patterns?
        util.stringToBase64(JSON.stringify(data.activeaiapp.interface.skippable_file_patterns)) : undefined;
    activeaiapp = data.activeaiapp;
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

async function search(searchText) {
    const id = session.get(APP_CONSTANTS.USERID).toString().toLowerCase(), org = session.get(APP_CONSTANTS.USERORG).toString().toLowerCase();
    const request = {id, org, aiappid: activeaiapp.id, question: searchText, flow: "docsearch_flow"};
    const apiPath = `${APP_CONSTANTS.API_PATH}/${activeaiapp.endpoint}`;
    const queryResult = await apiman.rest(`${apiPath}`, "POST", request, true);
    if (queryResult && queryResult.result) document.querySelector("span#results").innerText = JSON.stringify(queryResult, null, 2);
}

export const main = {initView, getNotifications, search};