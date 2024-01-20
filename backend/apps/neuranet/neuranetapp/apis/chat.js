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
 * License: See the enclosed LICENSE file.
 */
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const llmchat = require(`${NEURANET_CONSTANTS.LIBDIR}/llmchat.js`);

exports.doService = async jsonReq => llmchat.chat(jsonReq);