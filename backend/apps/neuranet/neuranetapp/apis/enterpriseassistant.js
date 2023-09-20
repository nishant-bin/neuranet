/**
 * AI based assistant API for a private knowledge base indexed by the AI DBs.
 * 
 * API Request
 * 	id - The user ID
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

const mustache = require("mustache");
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const chatAPI = require(`${NEURANET_CONSTANTS.APIDIR}/chat.js`);
const search = require(`${NEURANET_CONSTANTS.LIBDIR}/search.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
		LIMIT: "limit", NOKNOWLEDGE: "noknowledge"}, CHAT_MODEL_DEFAULT = "chat-knowledgebase-gpt35-turbo", 
	PROMPT_FILE_KNOWLEDGEBASE = "chat_knowledgebase_prompt.txt", PROMPT_FILE_STANDALONE_QUESTION = "chat_knowledgebase_summarize_question_prompt.txt",
	DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode, TFIDF_SEARCH_LANGS = NEURANET_CONSTANTS.CONF.tdidf_search_langs||["ja", "zh"];

exports.doService = async (jsonReq, _servObject, _headers, _url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got knowledge base chat request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	const id = jsonReq.id, org = jsonReq.org;
	if (!(await quota.checkQuota(id, org))) {
		LOG.error(`Disallowing the API call, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const chatsession = chatAPI.getUsersChatSession(id, jsonReq.session_id).chatsession;
	const aiModelToUseForChat = jsonReq.model||CHAT_MODEL_DEFAULT, 
		aiModelObjectForChat = await aiutils.getAIModel(aiModelToUseForChat),
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObjectForChat.driver.module}`;
	let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	const finalSessionObject = chatsession.length ? await chatAPI.trimSession(
		aiModelObjectForChat.max_memory_tokens||DEFAULT_MAX_MEMORY_TOKENS,
		chatAPI.jsonifyContentsInThisSession(chatsession), aiModelToUseForChat, 
		aiModelObjectForChat.token_approximation_uplift, aiModelObjectForChat.tokenizer, aiLibrary) : [];
	if (finalSessionObject.length) finalSessionObject[finalSessionObject.length-1].last = true;

	let questionToUseForSearch; if (finalSessionObject.length > 0) {
		const standaloneQuestionResult = await simplellm.prompt_answer(
			`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${PROMPT_FILE_STANDALONE_QUESTION}`, id, org, 
			{session: finalSessionObject, question: jsonReq.question});
		if (!standaloneQuestionResult) {
			LOG.error("Couldn't create a stand alone version of the user's question.");
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		}
		questionToUseForSearch = standaloneQuestionResult;
	} else questionToUseForSearch = jsonReq.question;
	
	const searchPlugin = TFIDF_SEARCH_LANGS.includes(langdetector.getISOLang(questionToUseForSearch)) ? "doctfidfsearch" : "docvectorsearch";
	const documentResultsForPrompt = await search.find(searchPlugin, id, org, questionToUseForSearch, aiModelToUseForChat);
	if ((!documentResultsForPrompt) || (!documentResultsForPrompt.length)) return {reason: REASONS.NOKNOWLEDGE, ...CONSTANTS.FALSE_RESULT};
	const documentsForPrompt = [], metadatasForResponse = []; for (const [i,documentResult] of documentResultsForPrompt.entries()) {
		documentsForPrompt.push({content: documentResult.text, document_index: i+1}); metadatasForResponse.push(documentResult.metadata) };

	const knowledgebasePromptTemplate = await aiutils.getPrompt(`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${PROMPT_FILE_KNOWLEDGEBASE}`);
	const knowledegebaseWithQuestion = mustache.render(knowledgebasePromptTemplate, {documents: documentsForPrompt, question: jsonReq.question});

	const jsonReqChat = { id, org, maintain_session: true, session_id: jsonReq.session_id,
		session: [{"role": aiModelObjectForChat.user_role, "content": knowledegebaseWithQuestion}], model: aiModelToUseForChat };
	const response = await chatAPI.doService(jsonReqChat);

	return {...response, metadatas: metadatasForResponse};
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.question && jsonReq.org);