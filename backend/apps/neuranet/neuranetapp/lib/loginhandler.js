/**
 * Login listener to inject Neuranet data into logins.
 * (C) 2023 TekMonks. All rights reserved.
 */

const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);
const register = require(`${LOGINAPP_CONSTANTS.API_DIR}/register.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

exports.init = _ => {
    dblayer.initDB(); 

    login.addLoginListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");
    register.addNewUserListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");
}

exports.viewInjector = async function(result) {
    if (result.tokenflag) try { result.views = await dblayer.getViewsForOrg(result.org); }
    catch (err) {return false;}
    return true;
}