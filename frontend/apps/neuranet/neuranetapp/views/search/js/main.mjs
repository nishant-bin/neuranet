/** 
 * View main module for the search view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const API_GET_EVENTS = "events", MODULE_PATH = util.getModulePath(import.meta),
    VIEW_PATH = util.resolveURL(`${MODULE_PATH}/../`);

function initView(data) {
    window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME] = {searchmain: main}; data.VIEW_PATH = VIEW_PATH;
    data.shownotifications = {action: "monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME].searchmain.getNotifications()"};
}

async function getNotifications() {
    const id = session.get(APP_CONSTANTS.USERID), org = session.get(APP_CONSTANTS.USERORG);
    const events = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_GET_EVENTS}`, "GET", {id: id.toString(), 
        org: org.toString()}, true);
    if ((!events) || (!events.result)) LOG.error(`Error fetching events.`); 

    const eventsArray = []; if (events?.result) for (const event of Object.values(events.events)) eventsArray.push({...event, VIEW_PATH});
    
    const eventsTemplate = document.querySelector("#notificationstemplate"), eventsHTML = eventsTemplate.innerHTML,
        matches = /<!--([\s\S]+)-->/g.exec(eventsHTML), template = matches[1]; 
    const renderedEvents = (await router.getMustache()).render(template, {events:eventsArray.length?
        eventsArray:undefined}); return renderedEvents;
}

export const main = {initView, getNotifications};