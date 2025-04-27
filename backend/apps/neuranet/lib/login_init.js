/**
 * Neuranet app's login subsystem init.
 * (C) 2023 TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");

exports.initSync = function(appName) {
    global.LOGINAPP_CONSTANTS = require(`${__dirname}/../loginappframework/apis/lib/loginappconstants.js`);
    let hostname; if (fs.existsSync(`${LOGINAPP_CONSTANTS.APP_ROOT}/conf/hostname.json`)) 
        hostname = require(`${LOGINAPP_CONSTANTS.APP_ROOT}/conf/hostname.json`); 
    else hostname = CONSTANTS.HOSTNAME;
    LOGINAPP_CONSTANTS.HOSTNAME = hostname; // select monkshu's default hostname if not exists in apps

    global.LOGINAPP_CONSTANTS.CONF = JSON.parse( mustache.render(fs.readFileSync(
        `${LOGINAPP_CONSTANTS.CONF_DIR}/loginapp.json`, "utf-8"), {app: appName, hostname}) );

    require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`).init();   // inits the login subsystem, is actually async

    require(`${LOGINAPP_CONSTANTS.LIB_DIR}/loginappAPIKeyChecker.js`).initSync();   // inits the security checker
}