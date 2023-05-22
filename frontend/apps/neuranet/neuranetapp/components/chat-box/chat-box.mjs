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
import {monkshu_component} from "/framework/js/monkshu_component.mjs";

const SESSION_OBJ_TEMPLATE = {"role": "user", "content": ""}, COMPONENT_PATH = util.getModulePath(import.meta); 
let sessionID, API_CHAT, USER_ID;

async function elementConnected(host) {
    API_CHAT = host.getAttribute("chatapi"); USER_ID = host.getAttribute("user");
	chat_box.setDataByHost(host, {COMPONENT_PATH});
}

async function elementRendered(host) {
    const shadowRoot = chat_box.getShadowRootByHost(host);
    const textareaEdit = shadowRoot.querySelector("textarea#messagearea")
    textareaEdit.focus();
}

async function send(containedElement) {
    const shadowRoot = chat_box.getShadowRootByContainedElement(containedElement);
    const userMessageArea = shadowRoot.querySelector("textarea#messagearea"), userPrompt = userMessageArea.value.trim();
    if (userPrompt == "") return;    // empty prompt, ignore

    const sessionRequest = {...SESSION_OBJ_TEMPLATE}; sessionRequest.content = userPrompt;

    const textareaEdit = shadowRoot.querySelector("textarea#messagearea"), buttonSendImg = shadowRoot.querySelector("img#send");
    textareaEdit.classList.add("readonly"); textareaEdit.setAttribute("readonly", "true"); buttonSendImg.src = `${COMPONENT_PATH}/img/spinner.svg`; 
    const oldInsertion = _insertAIResponse(shadowRoot, userMessageArea, userPrompt);
    let result = await apiman.rest(`${API_CHAT}`, "POST", {id: USER_ID, session: [sessionRequest], 
        maintain_session: true, session_id: sessionID}, true);
    
    const host = chat_box.getHostElement(containedElement), onResultChecker = host.getAttribute("oncheckresult");
    const functionCode = `let result = resultIn; return await ${onResultChecker};`;
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const resultChecker = onResultChecker ? result => new AsyncFunction("resultIn", functionCode)(result) : undefined;
    
    let responseOK = (result && result.result);
    if (resultChecker) {
        const checkResult = await resultChecker(result);
        if (!checkResult.ok) result = {response: checkResult.error||"Error"};
        responseOK = checkResult.ok;    // if response checked is provided use it to override our evaluation of the result
    } else if ((!result) || (!result.response)) result = {response: "Error"};

    sessionID = result.session_id;  // save session ID so that backend can maintain session
    _insertAIResponse(shadowRoot, userMessageArea, userPrompt, result.response, oldInsertion);

    // continue chat only if this response was OK.
    if (responseOK) { textareaEdit.classList.remove("readonly"); textareaEdit.removeAttribute("readonly"); buttonSendImg.src = `${COMPONENT_PATH}/img/send.svg`; } 
    else { buttonSendImg.onclick = ''; buttonSendImg.src = `${COMPONENT_PATH}/img/senddisabled.svg`; }   // sending more messages is now disabled as this chat is dead
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

export const chat_box = {trueWebComponentMode: true, elementConnected, elementRendered, send}
monkshu_component.register("chat-box", `${COMPONENT_PATH}/chat-box.html`, chat_box);
