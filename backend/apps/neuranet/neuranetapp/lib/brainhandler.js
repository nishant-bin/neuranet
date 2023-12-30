/**
 * Handles federated brains for Neuranet.
 * (C) 2023 TekMonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const cms = require(`${LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS.LIB_DIR}/cms.js`);

exports.initSync = _ => {
    cms.addCMSPathModifier((cmsroot, id, org, extraInfo) => {
        const activeBrainIDForUser = exports.getActiveBrainIDForUser(id, org, extraInfo);
        return `${cmsroot}/${activeBrainIDForUser}`;
    })
}

exports.getActiveBrainIDForUser = function(id, org, extraInfo) {
    if (!extraInfo) return NEURANET_CONSTANTS.DEFAULT_BRAIN_ID;

    if (extraInfo.id != id || extraInfo.org != org) return NEURANET_CONSTANTS.DEFAULT_BRAIN_ID;

    return extraInfo.activeBrainID||NEURANET_CONSTANTS.DEFAULT_BRAIN_ID;
}