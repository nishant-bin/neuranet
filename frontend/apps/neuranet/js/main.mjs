/* 
 * (C) 2020 TekMonks. All rights reserved.
 * License: See enclosed license.txt file.
 */
import {neuranetapp} from "./neuranetapp.mjs";
import {loginmanager} from "./loginmanager.mjs"
import {router} from "/framework/js/router.mjs";
import {securityguard} from "/framework/js/securityguard.mjs";

const gohomeListeners = [];

const logoutClicked = _ => loginmanager.logout();

const interceptPageData = _ => router.addOnLoadPageData(APP_CONSTANTS.MAIN_HTML, async data => {   // set admin role if applicable
    if (securityguard.getCurrentRole()==APP_CONSTANTS.ADMIN_ROLE) data.admin = true; 
    
    try { data = await neuranetapp.main(data, main); } catch (err) { LOG.error(`Error in initializing. The error is ${err}.`); }
});

async function gohome() {
    for (const listener of gohomeListeners) await listener();
    router.navigate(APP_CONSTANTS.MAIN_HTML);
}

async function showNotifications(action, event, bottom_menu) {
    const notifications = await eval(action);
    const context_menu = window.monkshu_env.components["context-menu"];
    context_menu.showMenu("contextmenumain", notifications, event.clientX, event.clientY, bottom_menu?5:10, bottom_menu?5:10, 
        null, true, bottom_menu, true);
}

const addGoHomeListener = listener => gohomeListeners.push(listener);

export const main = {logoutClicked, interceptPageData, gohome, addGoHomeListener, showNotifications}