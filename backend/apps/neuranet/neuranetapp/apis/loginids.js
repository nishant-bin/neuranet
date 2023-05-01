/**
 * Shows how to write APIs for apps embedded into the login app.
 * (C) 2023 TekMonks. All rights reserved.
 */

const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);

const _loginsSeenSoFar = [];

exports.init = _ => login.addLoginListener(result => {
    if (result.tokenflag) if (!_loginsSeenSoFar.includes(result.id)) _loginsSeenSoFar.push(result.id);
    return true;
});

exports.doService = async _jsonReq => {
    return {result: true, loginsSeen: _loginsSeenSoFar};
}