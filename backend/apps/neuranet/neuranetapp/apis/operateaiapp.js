/**
 * Operates on an org's AI apps. The caller must be an org 
 * admin.
 * 
 * API Request
 * 	org - the user's org (security is JWT enforced)
 *  aiappid - the AI app ID
 *  op can be
 *    - new (creates a new AI app by using default one as a template)
 *    - publish publishes the given AI app
 *    - unpublish unpublishes the given AI app
 *    - delete deletes the given AI app
 * 
 * API Response
 *  result - true or false
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

const OPS = Object.freeze({NEW: "new", DELETE: "delete", PUBLISH: "publish", UNPUBLISH: "unpublish"})

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT};
    const op = jsonReq.op.toLowerCase(), id = jsonReq.id, org = jsonReq.org.toLowerCase();  
    const aiappid = jsonReq.aiappid.toLowerCase().trim().replaceAll(" ", "_"); // ensuring that aiappid must not have spaces
    const aiapplabel = jsonReq.aiapplabel || NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP_LABEL;
    
    if (op == OPS.NEW) return {result: await aiapp.initNewAIAppForOrg(aiappid, aiapplabel, id, org)};
    else if (op == OPS.DELETE) return {result: await aiapp.deleteAIAppForOrg(aiappid, id, org)};
    else if (op == OPS.PUBLISH) return {result: await aiapp.publishAIAppForOrg(aiappid, org)};
    else if (op == OPS.UNPUBLISH) return {result: await aiapp.unpublishAIAppForOrg(aiappid, org)};
    else {LOG.error(`Unknown op ${op} for AI app ${aiappid}`); return CONSTANTS.FALSE_RESULT;}
}

exports.OPS = OPS;

const validateRequest = jsonReq => jsonReq.aiappid && jsonReq.id && jsonReq.org && jsonReq.op;