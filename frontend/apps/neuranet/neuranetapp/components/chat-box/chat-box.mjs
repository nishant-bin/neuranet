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

const COMPONENT_PATH = util.getModulePath(import.meta); 
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
    const shadowRoot = chat_box.getShadowRootByContainedElement(containedElement), host = chat_box.getHostElement(containedElement);
    const userMessageArea = shadowRoot.querySelector("textarea#messagearea"), userPrompt = userMessageArea.value.trim();
    if (userPrompt == "") return;    // empty prompt, ignore

    const textareaEdit = shadowRoot.querySelector("textarea#messagearea"), buttonSendImg = shadowRoot.querySelector("img#send");
    textareaEdit.classList.add("readonly"); textareaEdit.setAttribute("readonly", "true"); buttonSendImg.src = `${COMPONENT_PATH}/img/spinner.svg`; 
    const oldInsertion = _insertAIResponse(shadowRoot, userMessageArea, userPrompt);
    const onRequest = host.getAttribute("onrequest");
    const requestProcessor = util.createAsyncFunction(`return await ${onRequest};`), request = await requestProcessor({prompt: userPrompt});
    const result = await apiman.rest(`${API_CHAT}`, "POST", request, true);
    
    const onResult = host.getAttribute("onresult"), resultProcessor = util.createAsyncFunction(`return await ${onResult};`), 
        checkResult = await resultProcessor({result});
    _insertAIResponse(shadowRoot, userMessageArea, userPrompt, checkResult[checkResult.ok?"response":"error"], oldInsertion);

    if (!checkResult.ok) {  // sending more messages is now disabled as this chat is dead due to error
        buttonSendImg.onclick = ''; buttonSendImg.src = `${COMPONENT_PATH}/img/senddisabled.svg`;
    } else { // enable sending more messages
        textareaEdit.classList.remove("readonly"); textareaEdit.removeAttribute("readonly"); buttonSendImg.src = `${COMPONENT_PATH}/img/send.svg`;
    }   
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
