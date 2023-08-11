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
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);

const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, 
	MODEL_DEFAULT = "chat-gpt35-turbo", CHAT_SESSION_UPDATE_TIMESTAMP_KEY = "__last_update",
	CHAT_SESSION_MEMORY_KEY_PREFIX = "__org_monkshu_neuranet_chatsession", PROMPT_FILE = "chat_prompt.txt",
	DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode, DEFAULT_MAX_MEMORY_TOKENS = 1000;

exports.doService = async jsonReq => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got chat request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	if (!(await quota.checkQuota(jsonReq.id))) {
		LOG.error(`Disallowing the API call, as the user ${jsonReq.id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const aiKey = crypt.decrypt(NEURANET_CONSTANTS.CONF.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModelToUse = jsonReq.model || MODEL_DEFAULT, aiModelObject = await aiutils.getAIModel(aiModelToUse),
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObject.driver.module}`;
	let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
	const {chatsession, sessionID, sessionKey} = exports.getUsersChatSession(jsonReq.id, jsonReq.session_id);

	const jsonifiedSession = exports.jsonifyContentsInThisSession([...chatsession, ...(utils.clone(jsonReq.session))]);
	let finalSessionObject = await exports.trimSession(aiModelObject.max_memory_tokens||DEFAULT_MAX_MEMORY_TOKENS,
		jsonifiedSession, aiModelToUse, aiModelObject.token_approximation_uplift, aiModelObject.tokenizer, aiLibrary); 
	if (!finalSessionObject.length) finalSessionObject = [jsonifiedSession[jsonifiedSession.length-1]];	// at least send the latest question
	finalSessionObject[finalSessionObject.length-1].last = true;
	
	const response = await aiLibrary.process({session: finalSessionObject}, 
		`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${PROMPT_FILE}`, aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request ${JSON.stringify(jsonReq)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
		dblayer.logUsage(jsonReq.id, response.metric_cost, aiModelToUse);
		const {aiResponse, promptSummary, responseSummary} = _unmarshallAIResponse(response.airesponse, 
			jsonReq.session.at(-1).content);
		if (jsonReq.maintain_session) {
			chatsession.push({"role": aiModelObject.user_role, "content": promptSummary}, 
				{"role": aiModelObject.assistant_role, "content": responseSummary});
			chatsession[CHAT_SESSION_UPDATE_TIMESTAMP_KEY] = Date.now();
			const idSessions = DISTRIBUTED_MEMORY.get(sessionKey, {}); idSessions[sessionID] = chatsession;
			DISTRIBUTED_MEMORY.set(sessionKey, idSessions);
			LOG.debug(`Chat session saved to the distributed memory is ${JSON.stringify(chatsession)}.`); 
		}
		return {response: aiResponse, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT, session_id: sessionID};
	}
}

exports.getUsersChatSession = (userid, session_id_in) => {
	let chatsession = []; const sessionID = session_id_in||Date.now(), 
		sessionKey = `${CHAT_SESSION_MEMORY_KEY_PREFIX}_${userid}`; 
	const idSessions = DISTRIBUTED_MEMORY.get(sessionKey, {}); chatsession = idSessions[sessionID]||[];
	LOG.debug(`Distributed memory key for this session is: ${sessionKey}.`);
	LOG.debug(`Chat session saved previously is ${JSON.stringify(chatsession)}.`); 
	return {chatsession: utils.clone(chatsession), sessionID, sessionKey};
}

exports.trimSession = async function(max_session_tokens, sessionObjects, aiModelName, 
		token_approximation_uplift, tokenizer_name, tokenprocessor) {

	let tokensSoFar = 0; const sessionTrimmed = [];
	for (let i = sessionObjects.length - 1; i >= 0; i--) {
		const sessionObjectThis = sessionObjects[i];
		tokensSoFar = tokensSoFar + await tokenprocessor.countTokens(sessionObjectThis.content,
			aiModelName, token_approximation_uplift, tokenizer_name);
		if (tokensSoFar > max_session_tokens) break;
		sessionTrimmed.unshift(sessionObjectThis);
	}
	return sessionTrimmed;
}

exports.jsonifyContentsInThisSession = session => {
	for (const sessionObject of session) try {JSON.parse(sessionObject.content);} catch (err) {
		const jsonStr = JSON.stringify(sessionObject.content), jsonifiedStr = jsonStr.substring(1, jsonStr.length-1);
		sessionObject.content = jsonifiedStr;
	}
	return session;
}

function _unmarshallAIResponse(response, userPrompt) {
	try {
		const summaryRE = /\{["]*user["]*:\s*["]*(.*?)["]*,\s*["]*ai["]*:\s*["]*(.*?)["]*\}/g;
		const jsonSummaries = summaryRE.exec(response.trim());
		if (!jsonSummaries) throw new Error(`Error can't parse this response ${response} for summaries.`);
		const realResponse = response.replace(summaryRE, "");

		return {aiResponse: realResponse, promptSummary: jsonSummaries[1].trim(), 
			responseSummary: jsonSummaries[2].trim()};
	} catch (err) {
		LOG.error(`Returning unsummaried conversation as error parsing the AI response summaries, the error is ${err}, the response is ${response}`);
		return {aiResponse: response, promptSummary: userPrompt, responseSummary: response};
	}	
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.session && Array.isArray(jsonReq.session) && 
	jsonReq.session.length >= 1);