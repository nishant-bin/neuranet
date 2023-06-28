/**
 * Can return text from lots of different file types - uses Apache Tika. 
 * https://tika.apache.org/
 * 
 * (C) Apache.org - LICENSE - https://www.apache.org/licenses/LICENSE-2.0
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const mustache = require("mustache");
const fspromises = require("fs").promises;
const calljava = require(`${CONSTANTS.LIBDIR}/calljava.js`);

const ONE_GB_STRINGS = 1024*1024*1024;

let tikaconf, tikaFacade;

exports.getContent = async function(filepath) {
    if (filepath.toLowerCase().endsWith(".text") || filepath.toLowerCase().endsWith(".txt")) return fspromises.readFile(filepath, "utf8");

    if (!tikaFacade) await _createTikaFacade();
    const javaIOFile = java.import("java.io.File"), thisJavaFile = new javaIOFile(filepath);
    try {return await tika.parseToStringAsync(thisJavaFile);} catch (err) {LOG.error(`Tika error extracting file ${filepath}. Error was ${err}`); return null;}
}

async function _createTikaFacade() {
    if (!tikaconf) tikaconf = JSON.parse(mustache.render(await fspromises.readFile(`${__dirname}/tika.json`, "utf8"), 
        {__dirname: __dirname.split(path.sep).join(path.posix.sep)}));
    const java = await calljava.getJava(tikaconf.classpath, true);
    const tikaFacadeClass = java.import("org.apache.tika.Tika"); 
    tikaFacade = new tikaFacadeClass(); 
    tikaFacade.setMaxStringLengthSync(tikaconf.max_content_length||ONE_GB_STRINGS);
}