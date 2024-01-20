/**
 * Returns the list of published and unpublished AI apps for an org.
 * 
 * API Request
 * 	org - the user's org (security is JWT enforced)
 * 
 * API Response
 *  result - true or false
 *  aiapps - array, contains the list of apps for the org
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT};
    
    try {
        const aiapps = await dblayer.getAllAIAppsForOrg(jsonReq.org), aiappsForOrg = [];
        for (const aiappThis of aiapps) {
            const aiappObject = await aiapp.getAIApp(jsonReq.id, jsonReq.org, aiappThis.aiappid);
            aiappsForOrg.push(aiappObject);
        }
        
        return {...CONSTANTS.TRUE_RESULT, aiapps: aiappsForOrg};
    } catch(err) {
        LOG.error(`Error fetching AI apps for org ${jsonReq.org}, the error is: ${err}`);
        return CONSTANTS.FALSE_RESULT;
    }
}

const validateRequest = jsonReq => jsonReq.id && jsonReq.org;