/**
 * Handles federated brains for Neuranet.
 * (C) 2023 TekMonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const cms = require(`${LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS.LIB_DIR}/cms.js`);

exports.initSync = _ => {
    cms.addCMSPathModifier((cmsroot, id, org, extraInfo) => {
        const brainIDForUser = exports.getAppID(id, org, extraInfo);
        return `${cmsroot}/${brainIDForUser}`;
    })
}

exports.getAppID = function(id, org, extraInfo) {
    if (!extraInfo) return NEURANET_CONSTANTS.DEFAULT_AI_APP;

    if (extraInfo.id != id || extraInfo.org != org) return NEURANET_CONSTANTS.DEFAULT_AI_APP;

    return extraInfo.appid||NEURANET_CONSTANTS.DEFAULT_AI_APP;
}