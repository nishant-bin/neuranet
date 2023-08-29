/**
 * Gets/sets an org's API keys.
 * Input
 *   org - the org name
 *   type - get or set; if omitted, get is assumed
 *   keys - if type is set, then optionally the new keys to set for the org
 * 
 * Security - Only the org's logged in admin can call via a valid JWT token.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const loginapi = require(`${APP_CONSTANTS.API_DIR}/login.js`);

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}

    LOG.debug(`Got API keys request for org ${jsonReq.org}. The request is ${JSON.stringify(jsonReq)}.`);

    const orgKeys = jsonReq.type?.toLowerCase() == "set" ? _setOrgKeys(jsonReq.org, jsonReq.keys) : _getOrgKeys(jsonReq.org);

    return {keys: orgKeys, ...CONSTANTS.TRUE_RESULT};
}

async function _getOrgKeys(org) {
    let orgKeys = await loginapi.getOrgKeys(org);
    if (!orgKeys) {
        LOG.info(`Org API keys are not generated yet for org ${org}, generating.`);
        orgKeys = await loginapi.setOrgKeys(org);
    }
    return orgKeys;
}

async function _setOrgKeys(org, keys) {
    const orgKeys = await loginapi.setOrgKeys(org, keys);
    return orgKeys;
}

const validateRequest = jsonReq => jsonReq && jsonReq.org && jsonReq.type;
