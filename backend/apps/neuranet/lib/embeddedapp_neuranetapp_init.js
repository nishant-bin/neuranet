/**
 * Neuranet app init.
 * (C) 2023 TekMonks. All rights reserved.
 */

const APP_NAME = "neuranetapp"; // change this to the embedded app name

exports.initSync = function() {
    global.LOGINAPP_CONSTANTS.EMBEDDED_APP_NAME = APP_NAME;

    const EMBEDDED_APP_LIBDIR = `${LOGINAPP_CONSTANTS.APP_ROOT}/${APP_NAME}/lib`;
    global.LOGINAPP_CONSTANTS.ENV[`${APP_NAME.toUpperCase()}_CONSTANTS`] = 
        require(`${EMBEDDED_APP_LIBDIR}/${APP_NAME.toLowerCase()}constants.js`);
    require(`${EMBEDDED_APP_LIBDIR}/init.js`).initSync();
}