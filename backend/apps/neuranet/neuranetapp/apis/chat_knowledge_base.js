/**
 * AI based chat API for a private knowledge base indexed by the vector DB.
 * 
 * API Request
 * 	id - The user ID
 *  question - The user's question
 *  session_id - The session ID for a previous session if this is a continuation
 *  db - (optional) The vector DB corresponding to the knowledgebase to use for 
 *       this chat. Must specify if a non-default DB was used to setup the knowledgebase
 *       pertaining to the topic of this chat.
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const mustache = require("mustache");
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const chatAPI = require(`${NEURANET_CONSTANTS.APIDIR}/chat.js`);
const login = require(`${LOGINAPP_CONSTANTS.API_DIR}/login.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);

const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
		LIMIT: "limit", NOKNOWLEDGE: "noknowledge"}, CHAT_MODEL_DEFAULT = "chat-knowledgebase-gpt35-turbo", 
	PROMPT_FILE_KNOWLEDGEBASE = "chat_knowledgebase_prompt.txt", PROMPT_FILE_STANDALONE_QUESTION = "chat_knowledgebase_summarize_question_prompt.txt";

exports.doService = async (jsonReq, _servObject, headers, _url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got knowledge base chat request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);

	const id = login.getID(headers), org = login.getOrg(headers);
	if (!(await quota.checkQuota(id))) {
		LOG.error(`Disallowing the API call, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const chatsession = chatAPI.getUsersChatSession(id, jsonReq.session_id).chatsession;
	const aiModelToUseForChat = jsonReq.model||CHAT_MODEL_DEFAULT, aiModelObjectForChat = await aiutils.getAIModel(aiModelToUseForChat);

	let questionToSearchAndAsk; if (chatsession.length > 0) {
		const standaloneQuestionResult = await simplellm.prompt_answer(
			`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${PROMPT_FILE_STANDALONE_QUESTION}`, 
			jsonReq.id, {session: chatsession, question: jsonReq.question});
		if (!standaloneQuestionResult) {
			LOG.error("Couldn't create a stand alone version of the user's question. Error reason was "+summaryResponse.reason);
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		}
		questionToSearchAndAsk = standaloneQuestionResult;
	} else questionToSearchAndAsk = jsonReq.question;
	
	// strategy is to first find matching documents using TF.IDF and then use their vectors for a sematic 
	// search to build the in-context prompt training documents
	const tfidfDB = await aidbfs.getTFIDFDBForIDAndOrg(id, org, jsonReq.lang);
	const tfidfScoredDocuments = tfidfDB.query(questionToSearchAndAsk, aiModelObjectForChat.topK_tfidf, null, 
		aiModelObjectForChat.cutoff_score_tfidf);	// search using TF.IDF for matching documents first - only will use semantic search on vectors from these documents later
	if (tfidfScoredDocuments.length == 0) return {reason: REASONS.NOKNOWLEDGE, ...CONSTANTS.FALSE_RESULT};	// no knowledge
	const documentsToUseDocIDs = []; for (const tfidfScoredDoc of tfidfScoredDocuments) 
		documentsToUseDocIDs.push(tfidfScoredDoc.metadata[NEURANET_CONSTANTS.NEURANET_DOCID]);
	
	const aiModelToUseForEmbeddings = aiModelObjectForChat.embeddings_model;
	const embeddingsGenerator = async text => {
		const response = await embedding.createEmbeddingVector(id, text, aiModelToUseForEmbeddings); 
		if (response.reason != embedding.REASONS.OK) return null;
		else return response.embedding;
	}
	const vectorForUserPrompts = await embeddingsGenerator(questionToSearchAndAsk);
	if (!vectorForUserPrompts) {
		LOG.error(`Embedding vector generation failed for ${questionToSearchAndAsk}. Can't continue.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}

	let vectordb; try { vectordb = await aidbfs.getVectorDBForIDAndOrg(id, org, embeddingsGenerator) } catch(err) { 
		LOG.error(`Can't instantiate the vector DB for ID ${id}. Unable to continue.`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
	}
	const similarityResultsForPrompt = await vectordb.query(vectorForUserPrompts, aiModelObjectForChat.topK_vectors, 
		aiModelObjectForChat.min_distance_vectors, metadata => documentsToUseDocIDs.includes(metadata[NEURANET_CONSTANTS.NEURANET_DOCID]));
	if ((!similarityResultsForPrompt) || (!similarityResultsForPrompt.length)) return {reason: REASONS.NOKNOWLEDGE, ...CONSTANTS.FALSE_RESULT};
	const documents = [], metadatasForResponse = []; for (const [i,similarityResult] of similarityResultsForPrompt.entries()) {
		documents.push({content: similarityResult.text, document_index: i+1}); metadatasForResponse.push(similarityResult.metadata) };

	const knowledgebasePromptTemplate = await aiutils.getPrompt(`${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${PROMPT_FILE_KNOWLEDGEBASE}`);
	const knowledegebaseWithQuestion = mustache.render(knowledgebasePromptTemplate, {documents, question: questionToSearchAndAsk});

	const jsonReqChat = { id, maintain_session: true, session_id: jsonReq.session_id,
		session: [{"role": aiModelObjectForChat.user_role, "content": knowledegebaseWithQuestion}], model: aiModelToUseForChat };
	const response = await chatAPI.doService(jsonReqChat);

	return {...response, metadatas_for_response: metadatasForResponse};
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.question);