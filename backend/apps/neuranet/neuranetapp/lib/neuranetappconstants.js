/** 
 * Neuranet constants.
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const APPROOT = path.resolve(`${LOGINAPP_CONSTANTS.APP_ROOT}/${LOGINAPP_CONSTANTS.EMBEDDED_APP_NAME}`);
const BACKEND_ROOT = path.resolve(LOGINAPP_CONSTANTS.APP_ROOT);

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
exports.DEFAULT_ORG = "_org_neuranet_defaultorg_";
exports.DEFAULT_ID = "_default_";
exports.AIAPPDIR = path.resolve(`${BACKEND_ROOT}/aiapps`);
exports.DEFAULT_ORG_DEFAULT_AIAPP = "_org_neuranet_default_aiapp_";


exports.NEURANET_DOCID = "aidb_docid";
exports.NEURANET_LANGID = "aidb_langid";

exports.DYNAMIC_FILES_FOLDER = "dynamic";
exports.GENERATED_FILES_FOLDER = "_nueranet_generated";

exports.getPlugin = name => require(`${exports.LIBDIR}/pluginhandler.js`).getPlugin(name);

exports.NEURANETEVENT = "__org_monkshu_neuranet_event";
exports.EVENTS = Object.freeze({AIDB_FILE_PROCESSING: "aidb_file_processing", 
    AIDB_FILE_PROCESSED: "aidb_file_processed", FILE_CREATED: "filecreated",
    FILE_DELETED: "filedeleted", FILE_RENAMED: "filerenamed", FILE_MODIFIED: "filemodified"});
exports.FILEINDEXER_FILE_PROCESSED_EVENT_TYPES = Object.freeze({INGESTED: "ingest_process",
    UNINGESTED: "uningest_process", RENAMED: "rename_process", MODIFIED: "modified_process"});