/** 
 * (C) 2015 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */

const path = require("path");

const APP_ROOT = `${path.resolve(`${__dirname}/../../../`)}`;

exports.APP_ROOT = APP_ROOT;
exports.LIB_DIR = path.resolve(__dirname);
exports.API_DIR = path.resolve(`${__dirname}/../`);
exports.CONF_DIR = path.resolve(`${__dirname}/../../conf`);
exports.DB_DIR = `${APP_ROOT}/db`;
exports.ROLES = {ADMIN: "admin", USER: "user"};
exports.ENV = {};   // enviornment for embedded apps to use