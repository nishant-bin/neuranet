/** 
 * View main module for the search view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const API_GET_EVENTS = "events", VIEW_PATH = util.resolveURL(`${MODULE_PATH}/../`);
let EVENTS_TEMPLATE;

function initView(data) {
    window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME] = {searchmain: main}; data.VIEW_PATH = VIEW_PATH;
    data.shownotifications = {action: "monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME].searchmain.getNotifications()"};
}

async function getNotifications() {
    const id = session.get(APP_CONSTANTS.USERID), org = session.get(APP_CONSTANTS.USERORG);
    const events = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_GET_EVENTS}`, "GET", {id, org}, true);
    if (!events.result) LOG.error(`Error fetching events.`); 

    const eventsArray = []; if (events.result) for (const event of Object.values(events)) eventsArray.push(event);
    
    const renderedEvents = (await router.getMustache()).render(EVENTS_TEMPLATE, eventsArray); return renderedEvents;
}

const setEventsTemplate = template => EVENTS_TEMPLATE = template;

export const main = {initView, getNotifications, setEventsTemplate};