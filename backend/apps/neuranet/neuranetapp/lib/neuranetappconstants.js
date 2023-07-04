/** 
 * Neuranet constants.
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const APPROOT = path.resolve(`${LOGINAPP_CONSTANTS.APP_ROOT}/${LOGINAPP_CONSTANTS.EMBEDDED_APP_NAME}`);

exports.APPROOT = path.resolve(APPROOT);
exports.APIDIR = path.resolve(`${APPROOT}/apis`);
exports.CONFDIR = path.resolve(`${APPROOT}/conf`);
exports.LIBDIR = path.resolve(`${APPROOT}/lib`);
exports.TRAININGPROMPTSDIR = path.resolve(`${APPROOT}/training_prompts`);
exports.RESPONSESDIR = path.resolve(`${APPROOT}/sample_responses`);
exports.TEMPDIR = path.resolve(`${APPROOT}/temp`);
exports.THIRDPARTYDIR = path.resolve(`${APPROOT}/3p`);
exports.PLUGINSDIR = path.resolve(`${APPROOT}/plugins`);
exports.DBDIR = path.resolve(LOGINAPP_CONSTANTS.DB_DIR);
exports.AIDBPATH = path.resolve(`${LOGINAPP_CONSTANTS.DB_DIR}/ai_db`);

exports.NEURANET_DOCID = "aidb_docid";

exports.getPlugin = name => require(`${APPROOT}/plugins/${name}/${name}.js`);

exports.NEURANETEVENT = "__org_monkshu_neuranet_event";
exports.EVENTS = Object.freeze({VECTORDB_FILE_PROCESSING: "vectordb_file_processing", 
    VECTORDB_FILE_PROCESSED: "vectordb_file_processed"});
exports.VECTORDB_FILE_PROCESSED_EVENT_TYPES = Object.freeze({
    INGESTED: "vectordb_file_processed_ingested",
    UNINGESTED: "vectordb_file_processed_uningested",
    RENAMED: "vectordb_file_processed_renamed",
    MODIFIED: "vectordb_file_processed_modified"
});