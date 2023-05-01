/**
 * Shows how to init apps embedded into the login app.
 * (C) 2023 TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const loginhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`)

exports.initSync = _ => {
    _readConfSync();
    loginhandler.init(); 
}

function _readConfSync() {
    const confjson = mustache.render(fs.readFileSync(`${NEURANET_CONSTANTS.CONFDIR}/neuranet.json`, "utf8"), 
        NEURANET_CONSTANTS).replace(/\\/g, "\\\\");   // escape windows paths
    NEURANET_CONSTANTS.CONF = JSON.parse(confjson);
}