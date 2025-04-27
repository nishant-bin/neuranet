/** 
 * View main module for the search view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

let activeaiapp, DIV_RESULT_TEMPLATE, MUSTACHE, VIEW_PATH;

async function initView(data) {
    window.monkshu_env.apps[APP_CONSTANTS.APP_NAME] = {
            ...(window.monkshu_env.apps[APP_CONSTANTS.APP_NAME]||{}), search_main: main}; 
    data.VIEW_PATH = data.viewpath;
    activeaiapp = util.clone(data.activeaiapp);
    MUSTACHE = await router.getMustache();
    VIEW_PATH = data.viewpath;
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
    if (queryResult && queryResult.result) {
        const resultsUIFormattedObject = _formatResults(queryResult.documents||[]);
        const formattedHTMLResults = MUSTACHE.render(_getResultsTemplate(), resultsUIFormattedObject);
        document.querySelector("div#results").innerHTML = formattedHTMLResults;
    }
}

function _formatResults(documents) {
    const formattedDocuments = [];
    for (const document of documents) formattedDocuments.push({
        resulticon: `${VIEW_PATH}/img/searchgeneric.svg`,
        referencelink: document.metadata.referencelink,
        title: document.metadata.referencelink,
        textsnippet: document.text
    });
    return formattedDocuments;
}

function _getResultsTemplate() {
    if (DIV_RESULT_TEMPLATE) return DIV_RESULT_TEMPLATE;
    const resultsTemplate = document.querySelector("template#resultstemplate");
    DIV_RESULT_TEMPLATE = resultsTemplate.innerHTML;
    return DIV_RESULT_TEMPLATE;
}

export const main = {initView, getNotifications, search};