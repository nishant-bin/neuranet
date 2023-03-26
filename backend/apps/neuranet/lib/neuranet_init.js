/**
 * App init for Neuranet
 * (C) TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");

exports.initSync = _appName => {
    global.NEURANET_CONSTANTS = require(`${__dirname}/../appapis/lib/constants.js`);
    const confjson = mustache.render(fs.readFileSync(`${global.NEURANET_CONSTANTS.CONFDIR}/neuranet.json`, "utf8"), 
        global.NEURANET_CONSTANTS).replace(/\\/g, "\\\\");   // escape windows paths
    global.NEURANET_CONSTANTS.CONF = JSON.parse(confjson);
}