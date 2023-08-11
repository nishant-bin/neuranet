/**
 * Processes and informs about Neuranet events.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const EVENTS_KEY = "__org_monkshu_neuranet_events_key", MEM_TO_USE = CLUSTER_MEMORY;

exports.initSync = _ => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
    if ((message.type != NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSING && 
        message.type != NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED) || (!message.path)) return;  // we only care about these two

    const usermemory = _getUserMemory(message.id, message.org)
    usermemory[message.cmspath] = {...message, path: message.cmspath,   // overwrite full path as we don't want top send this out
        done:  message.type == NEURANET_CONSTANTS.EVENTS.VECTORDB_FILE_PROCESSED, result: message.result};
    _setUserMemory(message.id, message.org, usermemory);
});

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}

    const usermemory = _getUserMemory(jsonReq.id, jsonReq.org);
    return {events: (usermemory||{}), ...CONSTANTS.TRUE_RESULT};
}

const _setUserMemory = (id, org, usermemory) => { const memory = MEM_TO_USE.get(EVENTS_KEY, {}); 
    memory[_getmemkey(id, org)] = usermemory; MEM_TO_USE.set(EVENTS_KEY, memory); }
const _getUserMemory = (id, org) => { const memory = MEM_TO_USE.get(EVENTS_KEY, {});
    if (!memory[_getmemkey(id, org)])  memory[_getmemkey(id, org)] = {}; return memory[_getmemkey(id, org)]; }
const _getmemkey = (id, org) => `${id}_${org}`;

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.org);