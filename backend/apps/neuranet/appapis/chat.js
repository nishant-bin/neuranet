/**
 * AI based chat API. 
 * 
 * API Request
 * 	id - the user ID
 *  session - Array of [{"role":"user||assistant", "content":"[chat content]"}]
 *  maintain_session - The backend maintains the chat session instead of frontend
 *  session_id - The session ID for a previous session if this is a continuation
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);

const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest"}, 
	MODEL_DEFAULT = "chat-gpt35-turbo", CHAT_SESSION_UPDATE_TIMESTAMP_KEY = "__last_update",
	CHAT_SESSION_MEMORY_KEY_PREFIX = "__org_monkshu_neuranet_chatsession";

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got chat request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT,
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${NEURANET_CONSTANTS.CONF.ai_models[aiModelToUse].driver.module}`;
	let aiLibrary; try{aiLibrary = require(aiModuleToUse);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
	let chatsession = []; const sessionID = jsonReq.session_id||Date.now(), 
		sessionKey = CHAT_SESSION_MEMORY_KEY_PREFIX + jsonReq.id; 
	if (jsonReq.maintain_session) chatsession = (DISTRIBUTED_MEMORY.get(sessionKey, {})[sessionID])||[]; 

	const finalSessionObject = _jsonifyContentsInThisSession([...chatsession, ...(utils.clone(jsonReq.session))]); 
	finalSessionObject[finalSessionObject.length-1].last = true;

	const response = await aiLibrary.process({session: finalSessionObject}, 
		`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/chat_prompt.txt`, aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
		if (jsonReq.maintain_session) {
			chatsession.push({"role": "user", "content": finalSessionObject.at(-1).content},
				{"role": "assistant", "content": response.airesponse});
			chatsession[CHAT_SESSION_UPDATE_TIMESTAMP_KEY] = Date.now();
			const idSessions = DISTRIBUTED_MEMORY.get(sessionKey, {}); idSessions[sessionID] = chatsession;
			DISTRIBUTED_MEMORY.set(sessionKey, idSessions);
		}
		return {response: response.airesponse, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT, session_id: sessionID};
	}
}

const _jsonifyContentsInThisSession = session => {
	for (const sessionObject of session) try {JSON.parse(sessionObject.content);} catch (err) {
		const jsonStr = JSON.stringify(sessionObject.content), jsonifiedStr = jsonStr.substring(1, jsonStr.length-1);
		sessionObject.content = jsonifiedStr;
	}
	return session;
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.session && Array.isArray(jsonReq.session) && 
	jsonReq.session.length >= 1);