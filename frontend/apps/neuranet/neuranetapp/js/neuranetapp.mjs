/** 
 * Shows how to embed an app inside loginapp.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";

const MODULE_PATH = util.getModulePath(import.meta), AI_WORKSHOP_VIEW = "aiworkshop",
    MAIN_HTML = util.resolveURL(`${APP_CONSTANTS.EMBEDDED_APP_PATH}/main.html`), IMAGE_DATA = "data:image";

let loginappMain;

const main = async (data, mainLoginAppModule) => {
    window.monkshu_env.apps[APP_CONSTANTS.EMBEDDED_APP_NAME] = {main: neuranetapp};
    loginappMain = mainLoginAppModule; loginappMain.addGoHomeListener(gohome);
    APP_CONSTANTS.VIEWS_PATH = util.resolveURL(`${APP_CONSTANTS.EMBEDDED_APP_PATH}/views`);
    await _createdata(data); 
    data.maincontent = await router.loadHTML(MAIN_HTML, {...data}); 
}

async function _createdata(data) {   
    let viewPath, aiendpoint, views, activeaiapp; delete data.showhome; delete data.shownotifications;
    const loginresponse = session.get(APP_CONSTANTS.LOGIN_RESPONSE), appsAllowed = [...(loginresponse?.apps||[])];

    const _getAppToForceLoadOrFalse = _ => session.get(APP_CONSTANTS.FORCE_LOAD_VIEW)?.toString()||false;
    const _loadForcedView = appid => {
        if (appsAllowed.length > 1) data.showhome = true;
        const appidToOpen = appid||_getAppToForceLoadOrFalse(), 
            app = (appsAllowed.filter(app => app.id == appidToOpen))[0];
        viewPath = `${APP_CONSTANTS.VIEWS_PATH}/${app.interface.type}`;
        aiendpoint = app.endpoint; activeaiapp = app;
    }

     // load the given app if forced, or if apps allowed is just one, else load chooser
    if (appsAllowed.length == 1) _loadForcedView(appsAllowed[0].id);
    else if (_getAppToForceLoadOrFalse()) _loadForcedView();   
    else {    // left with chooser
        viewPath = `${APP_CONSTANTS.VIEWS_PATH}/${APP_CONSTANTS.VIEW_CHOOSER}`;
        views = []; 
        for (const app of appsAllowed) if (app.interface != APP_CONSTANTS.VIEW_CHOOSER) views.push(  // views we can choose from
            {viewicon: app.interface?.icon && app.interface.icon.toLowerCase().startsWith(IMAGE_DATA) ? app.interface.icon :
                `${APP_CONSTANTS.VIEWS_PATH}/${app.interface.type.toString()}/img/icon.svg`, 
            viewlabel: app.interface?.label||await i18n.get(`ViewLabel_${app.interface.type.toString()}`), 
            viewid: app.id});
    } 

    // now load the view's HTML
    const viewURL = `${viewPath}/main.html`, viewMainMJS = `${viewPath}/js/main.mjs`;
    data.viewpath = viewPath; data.aiendpoint = aiendpoint; data.activeaiapp = activeaiapp;
    try { const viewMain = await import(viewMainMJS); await viewMain.main.initView(data, neuranetapp); }    // init the view before loading it
    catch (err) { LOG.error(`Error in initializing view ${viewPath}.`); }
    data.viewcontent = await router.loadHTML(viewURL, {...data, views}); 
}

const gohome = _ => session.remove(APP_CONSTANTS.FORCE_LOAD_VIEW);

async function openView(appid) {
    session.set(APP_CONSTANTS.FORCE_LOAD_VIEW, appid);
    const {loginmanager} = await import (`${APP_CONSTANTS.LOGINFRAMEWORK_LIB_PATH}/loginmanager.mjs`);
    loginmanager.addLogoutListener(`${MODULE_PATH}/neuranetapp.mjs`, "neuranetapp", "onlogout");

    router.navigate(APP_CONSTANTS.MAIN_HTML);
}

function onlogout() {session.remove(APP_CONSTANTS.FORCE_LOAD_VIEW);}

const showMessage = message => loginappMain.showMessage(message);

const showError = error => {LOG.error(error); showMessage(error);}

export const neuranetapp = {main, openView, gohome, onlogout, showMessage, showError};