/** 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 * 
 * Checks API keys for Neuranet APIs.
 */

const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);

function initSync() {APIREGISTRY.ENV.CUSTOM_SECURITY_CHECKERS.neuranet_key_checker = this;}

function checkSecurity(_apiregentry, _url, req, headers, _servObject, reason) {
    if (!req.org) return false; // Neuranet uses org based keys for APIs
    if (login.isAPIKeySecure(headers, req.org)) return true;

    reason.reason = "API Key Error"; reason.code = 403; return false;   // key not found in the headers
}

module.exports = {checkSecurity, initSync};