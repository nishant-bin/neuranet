/**
 * Shows how to init apps embedded into the login app.
 * (C) 2023 TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

exports.initSync = _ => {
    _readConfSync();    // the files below need constants to be setup properly so require them after conf is setup

    const events = require(`${NEURANET_CONSTANTS.APIDIR}/events.js`);
    const fileindexer = require(`${NEURANET_CONSTANTS.LIBDIR}/fileindexer.js`);
    const loginhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`);
    const securitychecker = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranet_key_checker.js`);
    securitychecker.initSync();
    loginhandler.initSync(); 
    fileindexer.initSync();
    events.initSync();
}

function _readConfSync() {
    const confjson = mustache.render(fs.readFileSync(`${NEURANET_CONSTANTS.CONFDIR}/neuranet.json`, "utf8"), 
        NEURANET_CONSTANTS).replace(/\\/g, "\\\\");   // escape windows paths
    NEURANET_CONSTANTS.CONF = JSON.parse(confjson);
}