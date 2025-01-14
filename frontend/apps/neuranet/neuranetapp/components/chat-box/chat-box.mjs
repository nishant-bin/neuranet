/**
 * @module chat-box
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 * 
 * Provides a standard chatbox component.
 */

import {marked} from "./3p/marked.esm.min.js";
import {util} from "/framework/js/util.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";
import {monkshu_component} from "/framework/js/monkshu_component.mjs";

const COMPONENT_PATH = util.getModulePath(import.meta); 
let API_CHAT;

async function elementConnected(host) {
    API_CHAT = host.getAttribute("chatapi"); 
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
        processedResult = await resultProcessor({result});
    _insertAIResponse(shadowRoot, userMessageArea, userPrompt, processedResult[processedResult.ok?"response":"error"], oldInsertion);

    if (!processedResult.ok) {  // sending more messages is now disabled as this chat is dead due to error
        buttonSendImg.onclick = ''; buttonSendImg.src = `${COMPONENT_PATH}/img/senddisabled.svg`;
    } else { // enable sending more messages
        textareaEdit.classList.remove("readonly"); textareaEdit.removeAttribute("readonly"); buttonSendImg.src = `${COMPONENT_PATH}/img/send.svg`;
    }   
}

function _insertAIResponse(shadowRoot, userMessageArea, userPrompt, aiResponse, oldInsertion) {
    const insertionTemplate = shadowRoot.querySelector("template#chatresponse_insertion_template").content.cloneNode(true);   // insert current prompt and reply
    const insertion = oldInsertion||insertionTemplate.querySelector("div#insertiondiv");
    insertion.querySelector("span#userprompt").innerHTML = userPrompt;
    const elementAIResponse = insertion.querySelector("span#airesponse");
    if (aiResponse) {
        const htmlContent = _markdownToHTML(aiResponse);
        elementAIResponse.innerHTML = htmlContent + insertionTemplate.querySelector("span#controls").outerHTML;
        elementAIResponse.dataset.content = `<!doctype html>\n${htmlContent}\n</html>`;
        elementAIResponse.dataset.content_mime = "text/html";
    }
    shadowRoot.querySelector("div#chatmainarea").appendChild(insertion);
    const chatScroller = shadowRoot.querySelector("div#chatscroller");
    chatScroller.scrollTop = chatScroller.scrollHeight;

    shadowRoot.querySelector("div#start").classList.replace("visible", "hidden"); // hide the startup logo and messages
    chatScroller.classList.replace("hidden", "visible");  // show chats
    userMessageArea.value = ""; // clear text area for the next prompt

    return insertion;
}

function _markdownToHTML(text) {
    try {
        const html = marked.parse(text);
        return html;
    } catch (err) {
        LOG.error(`Markdown conversion error: ${err}, returning original text`);
        return text;
    }
}
 
export const chat_box = {trueWebComponentMode: true, elementConnected, elementRendered, send}
monkshu_component.register("chat-box", `${COMPONENT_PATH}/chat-box.html`, chat_box);
