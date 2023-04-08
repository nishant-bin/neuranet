/* 
 * (C) 2020 TekMonks. All rights reserved.
 * License: See enclosed license.txt file.
 */
import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs"
import {loginmanager} from "./loginmanager.mjs"
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {securityguard} from "/framework/js/securityguard.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const dialog = _ => monkshu_env.components['dialog-box'], MODULE_PATH = util.getModulePath(import.meta);

function toggleMenu() {
    const imgElement = document.querySelector("span#menubutton > img"), menuIsOpen = imgElement.src.indexOf("menu.svg") != -1;
    const menuDiv = document.querySelector("div#menu");

    if (menuIsOpen) {    
        menuDiv.classList.add("visible"); menuDiv.style.maxHeight = menuDiv.scrollHeight+"px"; 
        imgElement.src = "./img/menu_close.svg";
    } else {
        menuDiv.classList.remove("visible"); menuDiv.style.maxHeight = 0; 
        imgElement.src = "./img/menu.svg";
    }
}

async function changePassword(_element) {
    dialog().showDialog(`${APP_CONSTANTS.DIALOGS_PATH}/changepass.html`, true, true, {}, "dialog", ["p1","p2"], async result=>{
        const done = await loginmanager.changepassword(session.get(APP_CONSTANTS.USERID), result.p1);
        if (!done) dialog().error("dialog", await i18n.get("PWCHANGEFAILED"));
        else { dialog().hideDialog("dialog"); _showMessage(await i18n.get("PWCHANGED")); }
    });
}

async function showOTPQRCode(_element) {
    const id = session.get(APP_CONSTANTS.USERID).toString(); 
    const totpSec = await apiman.rest(APP_CONSTANTS.API_GETTOTPSEC, "GET", {id}, true, false); if (!totpSec || !totpSec.result) return;
    const qrcode = await _getTOTPQRCode(totpSec.totpsec);
    dialog().showDialog(`${APP_CONSTANTS.DIALOGS_PATH}/changephone.html`, true, true, {img:qrcode}, "dialog", ["otpcode"], async result => {
        const otpValidates = await apiman.rest(APP_CONSTANTS.API_VALIDATE_TOTP, "GET", {totpsec: totpSec.totpsec, otp:result.otpcode, id}, true, false);
        if (!otpValidates||!otpValidates.result) dialog().error("dialog", await i18n.get("PHONECHANGEFAILED"));
        else dialog().hideDialog("dialog");
    });
}

async function changeProfile(_element) {
    const sessionUser = loginmanager.getSessionUser();
    dialog().showDialog(`${APP_CONSTANTS.DIALOGS_PATH}/resetprofile.html`, true, true, sessionUser, "dialog", 
            ["name", "id", "org"], async result => {
        
        const updateResult = await loginmanager.registerOrUpdate(sessionUser.id, result.name, result.id, null, result.org);
        if (updateResult == loginmanager.ID_OK) dialog().hideDialog("dialog");
        else {
            let errorKey = "Internal"; switch (updateResult)
            {
                case loginmanager.ID_FAILED_EXISTS: errorKey = "Exists"; break;
                case loginmanager.ID_FAILED_OTP: errorKey = "OTP"; break;
                case loginmanager.ID_INTERNAL_ERROR: errorKey = "Internal"; break;
                case loginmanager.ID_DB_ERROR: errorKey = "Internal"; break;
                case loginmanager.ID_SECURITY_ERROR: errorKey = "SecurityError"; break;
                case loginmanager.ID_DOMAIN_ERROR: errorKey = "DomainError"; break;
                default: errorKey = "Internal"; break;
            }
            dialog().error("dialog", await i18n.get(`ProfileChangedFailed${errorKey}`));
        }
    });
}

function showLoginMessages() {
    const data = router.getCurrentPageData();
    if (data.showDialog) { _showMessage(data.showDialog.message); delete data.showDialog; router.setCurrentPageData(data); }
}

const logoutClicked = _ => loginmanager.logout();

const interceptPageData = _ => router.addOnLoadPageData(APP_CONSTANTS.MAIN_HTML, async data => {   
    if (securityguard.getCurrentRole()==APP_CONSTANTS.ADMIN_ROLE) data.admin = true;    // set admin role if applicable
    let viewURL, views; 
    const viewsAllowed = session.get(APP_CONSTANTS.USERVIEWS);
    if (!session.get(APP_CONSTANTS.FORCE_LOAD_VIEW)) {
        viewURL = viewsAllowed.length == 1?`${APP_CONSTANTS.VIEW_PATH}/${viewsAllowed[0]}/main.html` :
            `${APP_CONSTANTS.VIEW_PATH}/${APP_CONSTANTS.VIEW_CHOOSER}/main.html`
        views = []; for (const view of viewsAllowed) if (view != APP_CONSTANTS.VIEW_CHOOSER) views.push(  // views we can choose from
            {viewicon: `${APP_CONSTANTS.VIEW_PATH}/${view}/img/icon.svg`, 
                viewlabel: await i18n.get(`ViewLabel_${view}`), viewname: view});
    } else viewURL = `${APP_CONSTANTS.VIEW_PATH}/${session.get(APP_CONSTANTS.FORCE_LOAD_VIEW)}/main.html`;

    data.viewpath = viewURL.substring(0, viewURL.lastIndexOf("/"));
    data.showhome = viewsAllowed.length == 1 ? undefined : true;
    data.viewcontent = await router.loadHTML(viewURL, {...data, views}); 
});

function gohome() {
    session.remove(APP_CONSTANTS.FORCE_LOAD_VIEW);
    router.navigate(APP_CONSTANTS.MAIN_HTML);
}

function openView(viewname) {
    session.set(APP_CONSTANTS.FORCE_LOAD_VIEW, viewname);
    loginmanager.addLogoutListener(`${MODULE_PATH}/main.mjs`, "main", "onlogout");

    router.navigate(APP_CONSTANTS.MAIN_HTML);
}

function onlogout() {session.remove(APP_CONSTANTS.FORCE_LOAD_VIEW);}

async function _getTOTPQRCode(key) {
	const title = await i18n.get("Title");
	await $$.require(`${APP_CONSTANTS.COMPONENTS_PATH}/register-box/3p/qrcode.min.js`);
	return new Promise(resolve => QRCode.toDataURL(
	    `otpauth://totp/${title}?secret=${key}&issuer=TekMonks&algorithm=sha1&digits=6&period=30`, (_, data_url) => resolve(data_url)));
}

const _showMessage = message => dialog().showMessage(message, "dialog");
export const main = {toggleMenu, changePassword, showOTPQRCode, showLoginMessages, changeProfile, 
    logoutClicked, interceptPageData, openView, onlogout, gohome}