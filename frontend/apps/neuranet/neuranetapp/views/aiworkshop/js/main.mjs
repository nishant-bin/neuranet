/** 
 * View main module for the ai workshop view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {util} from "/framework/js/util.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const MODULE_PATH = util.getModulePath(import.meta), VIEW_PATH = util.resolveURL(`${MODULE_PATH}/../`);
const API_GET_AIAPPS = "getorgaiapps";

async function initView(data) {
    data.VIEW_PATH = VIEW_PATH;
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const aiAppsResult = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_GET_AIAPPS}`, "GET", {id, org}, true);
    data.aiapps = aiAppsResult.result ? aiAppsResult.aiapps : [];
}

export const main = {initView};