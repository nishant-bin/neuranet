/**
 * Runs AI flows and returns the data back or takes the actions coded in the
 * flows.
 * 
 * API Request
 * 	id - the user ID
 *  org - the user org
 *  session_id - The session ID for a previous session if this is a continuation
 *  flow_id - the flow ID to run
 *  message - the message for the flow
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */
const asb = require(`${ASB_CONSTANTS.LIBDIR}/asbinprocess.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;


const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"};

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got AI flow request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);
    const result = await asb.runflow(`${NEURANET_CONSTANTS.AIFLOWSDIR}/${jsonReq.flow_id}.json`);
    return result;
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.org && jsonReq.flow_id && jsonReq.message);