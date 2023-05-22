/**
 * @module chat-box
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 * 
 * Provides a standard chatbox component.
 */

import {util} from "/framework/js/util.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const SESSION_OBJ_TEMPLATE = {"role": "user", "content": ""}, COMPONENT_PATH = util.getModulePath(import.meta); 
let sessionID, API_CHAT, USER_ID;

async function elementConnected(host) {
    API_CHAT = host.getAttribute("chatapi"); USER_ID = host.getAttribute("user");
	chat_box.setDataByHost(host, {COMPONENT_PATH});
}

async function send(containedElement) {
    const shadowRoot = neuranet_sql.getShadowRootByContainedElement(containedElement);
    const userMessageArea = shadowRoot.querySelector("textarea#messagearea"), userPrompt = userMessageArea.value.trim();
    if (userPrompt == "") return;    // empty prompt, ignore

    const sessionRequest = {...SESSION_OBJ_TEMPLATE}; sessionRequest.content = userPrompt;

    const textareaEdit = shadowRoot.querySelector("textarea#messagearea"), buttonSendImg = shadowRoot.querySelector("img#send");
    textareaEdit.classList.add("readonly"); textareaEdit.setAttribute("readonly", "true"); buttonSendImg.src = `${COMPONENT_PATH}/img/spinner.svg`; 
    const oldInsertion = _insertAIResponse(userMessageArea, userPrompt);
    const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_CHAT}`, "POST", 
        {id: USER_ID, session: [sessionRequest], maintain_session: true, session_id: sessionID}, true);
    textareaEdit.classList.remove("readonly"); textareaEdit.removeAttribute("readonly"); buttonSendImg.src = `${COMPONENT_PATH}/img/send.svg`; 
    
    if (!(await APP_CONSTANTS.EMBEDDED_APP_MAIN.checkAndReportStandardAIErrors(result))) return;

    sessionID = result.session_id;  // save session ID so that backend can maintain session
    _insertAIResponse(shadowRoot, userMessageArea, userPrompt, result.response, oldInsertion);
}

function _insertAIResponse(shadowRoot, userMessageArea, userPrompt, aiResponse, oldInsertion) {
    const insertionTemplate = shadowRoot.querySelector("template#chatresponse_insertion_template");   // insert current prompt and reply
    const insertion = oldInsertion||insertionTemplate.content.cloneNode(true), 
        insertionDiv = oldInsertion||insertion.querySelector("div#insertiondiv");
    insertion.querySelector("span#userprompt").innerHTML = userPrompt;
    if (aiResponse) insertion.querySelector("span#airesponse").innerHTML = aiResponse;
    shadowRoot.querySelector("div#chatmainarea").appendChild(insertion);
    const chatScroller = shadowRoot.querySelector("div#chatscroller");
    chatScroller.scrollTop = chatScroller.scrollHeight;

    shadowRoot.querySelector("div#start").classList.replace("visible", "hidden"); // hide the startup logo and messages
    chatScroller.classList.replace("hidden", "visible");  // show chats
    userMessageArea.value = ""; // clear text area for the next prompt

    return insertionDiv;
}

export const chat_box = {trueWebComponentMode: true, elementConnected, send}
monkshu_component.register("chat-box", `${COMPONENT_PATH}/chat-box.html`, chat_box);
