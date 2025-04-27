/**
 * Neuranet app init.
 * (C) 2023 TekMonks. All rights reserved.
 */

const APP_NAME = "neuranetapp"; // change this to the embedded app name
const xbin_init = require(`${__dirname}/xbin_init.js`);

exports.initSync = function() {
    xbin_init.initSync();   // because we rely on XBin's constants in Neuranet

    const EMBEDDED_APP_LIBDIR = `${LOGINAPP_CONSTANTS.APP_ROOT}/${APP_NAME}/lib`;
    global.LOGINAPP_CONSTANTS.ENV[`${APP_NAME.toUpperCase()}_CONSTANTS`] = 
        require(`${EMBEDDED_APP_LIBDIR}/${APP_NAME.toLowerCase()}constants.js`);
    require(`${EMBEDDED_APP_LIBDIR}/init.js`).initSync();
}