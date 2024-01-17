/**
 * Login listener to inject Neuranet data into logins.
 * (C) 2023 TekMonks. All rights reserved.
 */

const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);
const register = require(`${LOGINAPP_CONSTANTS.API_DIR}/register.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

exports.initSync = _ => {
    dblayer.initDB(); 

    login.addLoginListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");
    register.addNewUserListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");
}

exports.viewInjector = async function(result) {
    if (result.tokenflag) try {     // add in all AI apps the user has access to
        const aiapps = await dblayer.getAllAIAppsForOrg(result.org), aiappsForUser = [];
        for (const aiappThis of aiapps) {
            const aiappObject = await aiapp.getAIApp(result.id, result.org, aiappThis.aiappid),
                usersThisApp = aiappObject?aiappObject.users:[];
            if (usersThisApp.includes('*') || usersThisApp.some(id => id.toLowerCase() == result.id.toLowerCase()))
                aiappsForUser.push({id: aiappObject.id, interface: aiappObject.interface, endpoint: aiappObject.endpoint});
        }
        result.apps = aiappsForUser; 
        return true;
    } catch (err) {return false;}
}