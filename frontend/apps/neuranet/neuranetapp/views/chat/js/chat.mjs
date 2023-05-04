/**
 * @module chat
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 * 
 * Supports the chat view.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const API_CHAT = "chat", SESSION_OBJ_TEMPLATE = {"role": "user", "content": ""}, 
    VIEW_PATH = util.resolveURL(`${util.getModulePath(import.meta)}/../`); 
let sessionID;

const dialog = _ => monkshu_env.components['dialog-box'];

async function send(_element) {
    const userMessageArea = document.querySelector("textarea#messagearea"), userPrompt = userMessageArea.value.trim();
    if (userPrompt == "") return;    // empty prompt, ignore

    const sessionRequest = {...SESSION_OBJ_TEMPLATE}; sessionRequest.content = userPrompt;

    const textareaEdit = document.querySelector("textarea#messagearea"), buttonSendImg = document.querySelector("img#send");
    textareaEdit.classList.add("readonly"); textareaEdit.setAttribute("readonly", "true"); buttonSendImg.src = `${VIEW_PATH}/img/spinner.svg`; 
    const oldInsertion = _insertAIResponse(userMessageArea, userPrompt);
    const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_CHAT}`, "POST", 
        {id: session.get(APP_CONSTANTS.USERID), session: [sessionRequest], maintain_session: true, 
            session_id: sessionID}, true);
    textareaEdit.classList.remove("readonly"); textareaEdit.removeAttribute("readonly"); buttonSendImg.src = `${VIEW_PATH}/img/send.svg`; 
    
    if (!result || (!result.result)) {_showMessage(await i18n.get("ChatAIError")); return;}

    sessionID = result.session_id;  // save session ID so that backend can maintain session
    _insertAIResponse(userMessageArea, userPrompt, result.response, oldInsertion);
}

function _insertAIResponse(userMessageArea, userPrompt, aiResponse, oldInsertion) {
    const insertionTemplate = document.querySelector("template#chatresponse_insertion_template");   // insert current prompt and reply
    const insertion = oldInsertion||insertionTemplate.content.cloneNode(true), 
        insertionDiv = oldInsertion||insertion.querySelector("div#insertiondiv");
    insertion.querySelector("span#userprompt").innerHTML = userPrompt;
    if (aiResponse) insertion.querySelector("span#airesponse").innerHTML = aiResponse;
    document.querySelector("div#chatmainarea").appendChild(insertion);
    const chatScroller = document.querySelector("div#chatscroller");
    chatScroller.scrollTop = chatScroller.scrollHeight;

    document.querySelector("div#start").classList.replace("visible", "hidden"); // hide the startup logo and messages
    chatScroller.classList.replace("hidden", "visible");  // show chats
    userMessageArea.value = ""; // clear text area for the next prompt

    return insertionDiv;
}

const _showMessage = message => dialog().showMessage(message, "dialog");

export const chat = {send};