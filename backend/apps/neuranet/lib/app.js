/**
 * Initializes the application.
 * (C) TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");

exports.initSync = appName => {
    global.APP_CONSTANTS = require(`${__dirname}/../loginappframework/apis/lib/loginappconstants.js`);
    let hostname; if(fs.existsSync(`${APP_CONSTANTS.APP_ROOT}/conf/hostname.json`)) { hostname = require(`${APP_CONSTANTS.APP_ROOT}/conf/hostname.json`); 
    } else { hostname = CONSTANTS.HOSTNAME; } APP_CONSTANTS.HOSTNAME = hostname; // select monkshu's default hostname if not exists in apps
    global.APP_CONSTANTS.CONF = JSON.parse( mustache.render(fs.readFileSync(
        `${APP_CONSTANTS.CONF_DIR}/loginapp.json`, "utf-8"), {app: appName, hostname}) );
    global.LOGINAPP_CONSTANTS = APP_CONSTANTS;  // will be the namespace used in the future.

    require(`${APP_CONSTANTS.LIB_DIR}/userid.js`).initDB(true);   // inits the DB, will eat the error on failure

    require(`${APP_CONSTANTS.API_DIR}/login.js`).init();   // inits the login subsystem

    require(`${APP_CONSTANTS.LIB_DIR}/loginappAPIKeyChecker.js`).initSync();   // inits the security checker
    
    require(`${APP_CONSTANTS.LIB_DIR}/deleteunverifiedaccounts.js`).init();    // init expired accounts cleanup service

    for (const dirEntry of fs.readdirSync(__dirname, {withFileTypes: true}))   // init wrapped apps
        if (dirEntry.isFile() && dirEntry.name.toLowerCase().endsWith("_init.js")) 
            require(`${__dirname}/${dirEntry.name}`).initSync();
}