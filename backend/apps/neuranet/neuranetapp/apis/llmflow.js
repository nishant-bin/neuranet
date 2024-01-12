/**
 * API endpoint to run LLM flows.
 * 
 * API Request
 * 	id - The user ID
 *  org - The user org
 *  appid - The AI app to use
 *  question - The user's question
 *  session_id - The session ID for a previous session if this is a continuation
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 *  metadatas - the response document metadatas. typically metadata.referencelink points
 * 				to the exact document
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);

exports.doService = async (jsonReq, _servObject, _headers, _url) => {
	if (!validateRequest(jsonReq)) {
        LOG.error("Validation failure."); return {reason: llmflowrunner.REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got knowledge base chat request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

    const result = await llmflowrunner.answer(jsonReq.question, jsonReq.id, jsonReq.org, brainhandler.getAppID(jsonReq));
    return result;
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.question && jsonReq.org);