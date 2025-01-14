/**
 * Initializes the application.
 * (C) TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");
const XBIN_CONSTANTS = require(`${__dirname}/xbinconstants.js`);

exports.initSync = _appName => {
    const xbinson = mustache.render(fs.readFileSync(`${XBIN_CONSTANTS.CONF_DIR}/xbin.json`, "utf8"), 
        {...XBIN_CONSTANTS, hostname: LOGINAPP_CONSTANTS.HOSTNAME}).replace(/\\/g, "\\\\");   // escape windows paths
    XBIN_CONSTANTS.CONF = JSON.parse(xbinson);
    global.XBIN_CONSTANTS = XBIN_CONSTANTS; // setup constants

    require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`).init();    // init cms which inits our ID change listeners
    require(`${XBIN_CONSTANTS.API_DIR}/sharefile.js`).init();    // init the file sharing subsystem
}