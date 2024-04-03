/** 
 * Returns true or false depending on whether we should
 * enable remote logging.
 * (C) 2020 TekMonks. All rights reserved.
 */

const conf = require(`${__dirname}/../conf/loginapp.json`);

exports.doService = async _jsonReq => {return {result: true, remote_log: conf.remote_log};}