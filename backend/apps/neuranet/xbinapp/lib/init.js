/**
 * App init for XBin
 * (C) TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");
const XBIN_CONSTANTS = LOGINAPP_CONSTANTS.ENV.XBIN_CONSTANTS;

exports.initSync = _ => {
    const xbinson = mustache.render(fs.readFileSync(`${XBIN_CONSTANTS.CONF_DIR}/xbin.json`, "utf8"), 
        XBIN_CONSTANTS).replace(/\\/g, "\\\\");   // escape windows paths
    XBIN_CONSTANTS.CONF = JSON.parse(xbinson);
    require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`).init();    // init cms which inits our ID change listeners
    require(`${XBIN_CONSTANTS.API_DIR}/sharefile.js`).init();    // init the file sharing subsystem
}