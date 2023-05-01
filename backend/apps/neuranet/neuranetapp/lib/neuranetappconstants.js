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
exports.DBDIR = path.resolve(LOGINAPP_CONSTANTS.DB_DIR);
