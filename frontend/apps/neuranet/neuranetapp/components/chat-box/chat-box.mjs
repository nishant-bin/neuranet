/**
 * @module chat-box
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 * 
 * Provides a standard chatbox component.
 */

import {util} from "/framework/js/util.mjs";
import {marked} from "./3p/marked.esm.min.js";
import {router} from "/framework/js/router.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";
import {monkshu_component} from "/framework/js/monkshu_component.mjs";

const COMPONENT_PATH = util.getModulePath(import.meta), DEFAULT_MAX_ATTACH_SIZE = 4194304, 
    DEFAULT_MAX_ATTACH_SIZE_ERROR = "File size is larger than allowed size";

async function elementConnected(host) {
    const ATTACHMENT_ALLOWED = host.getAttribute("attach")?.toLowerCase() == "true";
	chat_box.setDataByHost(host, {COMPONENT_PATH, ATTACHMENT_ALLOWED: ATTACHMENT_ALLOWED?"true":undefined});
    const memory = chat_box.getMemoryByHost(host); memory.FILES_ATTACHED = [];
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

    const divDisabled = shadowRoot.querySelector("div#message div#disabled"), buttonSendImg = shadowRoot.querySelector("img#send");
    divDisabled.style.display = "block"; buttonSendImg.src = `${COMPONENT_PATH}/img/spinner.svg`; 
    const oldInsertion = _insertAIResponse(shadowRoot, userMessageArea, userPrompt, undefined, undefined, false);
    const onRequest = host.getAttribute("onrequest"), api_chat = host.getAttribute("chatapi");
    const requestProcessor = util.createAsyncFunction(`return await ${onRequest};`), 
        request = await requestProcessor({prompt: userPrompt, files: _getMemory(containedElement).FILES_ATTACHED});
    const result = await apiman.rest(`${api_chat}`, "POST", request, true);

    const onResult = host.getAttribute("onresult"), resultProcessor = util.createAsyncFunction(`return await ${onResult};`), 
        processedResult = await resultProcessor({result});
    _insertAIResponse(shadowRoot, userMessageArea, userPrompt, processedResult[processedResult.ok?"response":"error"], oldInsertion, true);

    if (!processedResult.ok) {  // sending more messages is now disabled as this chat is dead due to error
        buttonSendImg.onclick = ''; buttonSendImg.src = `${COMPONENT_PATH}/img/senddisabled.svg`;
    } else { // enable sending more messages
        buttonSendImg.src = `${COMPONENT_PATH}/img/send.svg`;
        divDisabled.style.display = "none";
    }   
}

async function attach(containedElement) {
    const host = chat_box.getHostElement(containedElement), accepts = host.getAttribute("attachaccepts") || "*/*";
    const {name, data} = await util.uploadAFile(accepts, "binary", 
        host.getAttribute("maxattachsize")||DEFAULT_MAX_ATTACH_SIZE, host.getAttribute("maxattachsizeerror")||DEFAULT_MAX_ATTACH_SIZE_ERROR);
    const bytes64 = await util.bufferToBase64(data), fileid = name.replaceAll(".","_")+"_"+Date.now();
    const fileObject = {filename: name, bytes64, fileid}; 
    const memory = _getMemory(containedElement); memory.FILES_ATTACHED.push(fileObject);

    const shadowRoot = chat_box.getShadowRootByContainedElement(containedElement);
    const insertionHTML = shadowRoot.querySelector("template#fileattachment_insertion_template").innerHTML.trim();   // clone
    const renderedHTML = (await router.getMustache()).render(insertionHTML, fileObject);
    const tempNode = document.createElement("template"); tempNode.innerHTML = renderedHTML;
    const newNode = tempNode.content.cloneNode(true);
    const insertionNode = shadowRoot.querySelector("span#attachedfiles");
    insertionNode.appendChild(newNode);
}

async function detach(containedElement, fileid) {
    const memory = _getMemory(containedElement);
    memory.FILES_ATTACHED = memory.FILES_ATTACHED.filter(fileobject => fileobject.fileid != fileid);
    const shadowRoot = chat_box.getShadowRootByContainedElement(containedElement);
    const insertionNode = shadowRoot.querySelector("span#attachedfiles");
    const nodeToDelete = insertionNode.querySelector(`span#${fileid}`);
    if (nodeToDelete) insertionNode.removeChild(nodeToDelete);
}

function _detachAllFiles(shadowRoot, clearAttachedFileMemory) {
    const containedElement = shadowRoot.querySelector("div#body");
    if (clearAttachedFileMemory) {const memory = _getMemory(containedElement); memory.FILES_ATTACHED = [];}
    const insertionNode = shadowRoot.querySelector("span#attachedfiles");
    while (insertionNode.firstChild) insertionNode.removeChild(insertionNode.firstChild);
}

function _insertAIResponse(shadowRoot, userMessageArea, userPrompt, aiResponse, oldInsertion, clearAttachedFileMemory) {
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
    _detachAllFiles(shadowRoot, clearAttachedFileMemory);  // clear file attachments

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

const _getMemory = containedElement => chat_box.getMemoryByContainedElement(containedElement);
 
export const chat_box = {trueWebComponentMode: true, elementConnected, elementRendered, send, attach, detach}
monkshu_component.register("chat-box", `${COMPONENT_PATH}/chat-box.html`, chat_box);
