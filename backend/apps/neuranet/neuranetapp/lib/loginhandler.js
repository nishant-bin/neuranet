/**
 * Login listener to inject Neuranet data into logins.
 * (C) 2023 TekMonks. All rights reserved.
 */

const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);
const register = require(`${LOGINAPP_CONSTANTS.API_DIR}/register.js`);
const updateuser = require(`${LOGINAPP_CONSTANTS.API_DIR}/updateuser.js`);

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

exports.initSync = _ => {
    login.addLoginListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");
    register.addNewUserListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");
    updateuser.addUpdateUserListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");

}

exports.viewInjector = async function(result) {
    if (result.tokenflag) try {     // add in all AI apps the user has access to
        try {
            const aiapps = (await aiapp.getAllAIAppsForOrg(result.id, result.org, true))||[], aiappsForUser = [];
            if (aiapps.length == 0) aiapps.push({id: NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP});   // use default app if none found
            for (const aiappThis of aiapps) {
                const aiappObject = await aiapp.getAIApp(result.id, result.org, aiappThis.id),
                    usersThisApp = aiappObject?aiappObject.users:[], adminsThisApp = aiappObject?aiappObject.admins:[];
                if (usersThisApp.includes('*') || usersThisApp.some(id => id.toLowerCase() == result.id.toLowerCase()))
                    aiappsForUser.push({id: aiappObject.id, interface: aiappObject.interface, 
                        endpoint: aiappObject.endpoint, 
                        is_user_appadmin: adminsThisApp.some(id => id.toLowerCase() == result.id.toLowerCase())});
            }
            result.apps = aiappsForUser; 
        } catch(err) {
            LOG.error(`Error fetching AI apps for org ${result.org}, the error is: ${err}`);
            result.apps = [];
        }
        return true;
    } catch (err) {return false;}
}
