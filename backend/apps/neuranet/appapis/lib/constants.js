/** 
 * Neuranet constants.
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");

APPROOT = `${path.resolve(`${__dirname}/../../`)}`;

exports.APPROOT = APPROOT;
exports.APIDIR = `${APPROOT}/appapis`;
exports.CONFDIR = `${APPROOT}/appapis/conf`;
exports.LIBDIR = `${APPROOT}/appapis/lib`;
exports.PROMPTSDIR = `${APPROOT}/appapis/prompts`;