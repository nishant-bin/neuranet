/**
 * Handles federated brains for Neuranet.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const cms = require(`${LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS.LIB_DIR}/cms.js`);

exports.initSync = _ => {
    cms.addCMSPathModifier(async (cmsroot, id, org, extraInfo) => {
        const brainIDForUser = await exports.getAppID(id, org, extraInfo);
        return `${cmsroot}/${brainIDForUser}`;
    });
}

exports.isThisDefaultOrgsDefaultApp = (_id, _org, aiappid) => aiappid == NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP;

exports.getAppID = async function(id, org, extraInfo) {
    // everything is ok so use what is requested
    if (extraInfo && (extraInfo.id == id) && (extraInfo.org == org) && (extraInfo.aiappid)) return extraInfo.aiappid;    

    // if this org has a default app then use that if missing
    if (org) {
        const orgSettings = await dblayer.getOrgSettings(org);
        if (orgSettings.defaultapp) return orgSettings.defaultapp; 
    } 

    // finally failover to default org's default AI app
    return NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP; 
}