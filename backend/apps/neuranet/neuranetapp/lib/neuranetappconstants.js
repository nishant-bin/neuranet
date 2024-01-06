/** 
 * Neuranet constants.
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
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
exports.AIAPPDIR = path.resolve(`${BACKEND_ROOT}/aiapps`);
exports.DEFAULT_AI_APP = "default";
exports.DEFAULT_AI_APP_PATH = path.resolve(`${exports.AIAPPDIR}/${exports.DEFAULT_ORG}/${exports.DEFAULT_AI_APP}`);

exports.NEURANET_DOCID = "aidb_docid";
exports.NEURANET_LANGID = "aidb_langid";

exports.DYNAMIC_FILES_FOLDER = "dynamic";
exports.GENERATED_FILES_FOLDER = "_nueranet_generated";

exports.getPlugin = name => serverutils.requireWithDebug(`${APPROOT}/plugins/${name}/${name}.js`, 
    LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS.CONF.debug_mode);

exports.NEURANETEVENT = "__org_monkshu_neuranet_event";
exports.EVENTS = Object.freeze({AIDB_FILE_PROCESSING: "aidb_file_processing", 
    AIDB_FILE_PROCESSED: "aidb_file_processed", FILE_CREATED: "filecreated",
    FILE_DELETED: "filedeleted", FILE_RENAMED: "filerenamed", FILE_MODIFIED: "filemodified"});
exports.FILEINDEXER_FILE_PROCESSED_EVENT_TYPES = Object.freeze({INGESTED: "ingest_process",
    UNINGESTED: "uningest_process", RENAMED: "rename_process", MODIFIED: "modified_process"});