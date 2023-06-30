/**
 * Can return text from lots of different file types - uses Apache Tika. 
 * https://tika.apache.org/
 * 
 * (C) Apache.org - LICENSE - https://www.apache.org/licenses/LICENSE-2.0
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const fs = require("fs");
const path = require("path");
const fspromises = fs.promises;
const mustache = require("mustache");
const calljava = require(`${CONSTANTS.LIBDIR}/calljava.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const ONE_GB_STRINGS = 1024*1024*1024, TIKA_TEMP_SUBDIR_WRITE = `${NEURANET_CONSTANTS.TEMPDIR}/tika/out`, 
    TIKA_TEMP_SUBDIR_READ = `${NEURANET_CONSTANTS.TEMPDIR}/tika/in`;

let tikaconf, tikaFacade, java;

exports.initAsync = async _ => {
    await _createTikaFacade();
    try { await fspromises.access(TIKA_TEMP_SUBDIR_READ); } catch (err) {
        if (err.code == "ENOENT") await fspromises.mkdir(TIKA_TEMP_SUBDIR_READ, {recursive: true});
        else {LOG.error(`Can't access temporary paths needed by Tika. The error was ${err}.`); throw err;}
    }
    try { await fspromises.access(TIKA_TEMP_SUBDIR_WRITE); } catch (err) { 
        if (err.code == "ENOENT") await fspromises.mkdir(TIKA_TEMP_SUBDIR_WRITE, {recursive: true});
        else {LOG.error(`Can't access temporary paths needed by Tika. The error was ${err}.`); throw err;}
    }
}

exports.getContentStream = async function (inputstream, filepath) {
    if (!tikaFacade) try { await exports.initAsync(); } catch (err) {
        LOG.error(`Unable to initialize the Tika plugin for text extraction. Error was ${err}`);
        return null; 
    }

    const basename = path.basename(filepath), extension = path.extname(filepath);
    if (!tikaconf.supported_types.includes(extension)) return null;

    if (filepath.toLowerCase().endsWith(".text") || filepath.toLowerCase().endsWith(".txt")) {
        LOG.info(`Tika.js using native text reader assuming UTF8 for the file ${filepath}.`);
        return inputstream;
    }

    LOG.info(`Tika.js using 3P Apache Tika libraries for the file ${filepath}.`);

    const workingareaReadPath = `${TIKA_TEMP_SUBDIR_READ}/${Date.now()}_${basename}`;
    const workingareaWritePath = `${TIKA_TEMP_SUBDIR_WRITE}/${Date.now()}_${basename}.txt`;
    await _copyFileToWorkingArea(inputstream, workingareaReadPath);

    const thisInputPath = java.callStaticMethodSync("java.nio.file.Paths", "get", workingareaReadPath), 
        thisOutputPath = java.callStaticMethodSync("java.nio.file.Paths", "get", workingareaWritePath);
    const thisTikaInputStream = java.callStaticMethodSync("org.apache.tika.io.TikaInputStream", "get", thisInputPath);
    const thisOutputStream = java.callStaticMethodSync("java.nio.file.Files", "newOutputStream", thisOutputPath);
    const javaPrintWriter = java.import("java.io.PrintWriter"), thisPrintWriter = new javaPrintWriter(thisOutputStream);
    const javaBodyContentHandler = java.import("org.apache.tika.sax.BodyContentHandler"), thisBodyContentHandler = new javaBodyContentHandler(thisPrintWriter);
    const javaAutoDetectParser =  java.import("org.apache.tika.parser.AutoDetectParser"), thisParser = new javaAutoDetectParser();
    const javaMetadata = java.import("org.apache.tika.metadata.Metadata"), thisMetadata = new javaMetadata();
    const javaParseContext = java.import("org.apache.tika.parser.ParseContext"), thisContext = new javaParseContext();

    try {
        await thisParser.parseAsync(thisTikaInputStream, thisBodyContentHandler, thisMetadata, thisContext);
        return fs.createReadStream(workingareaWritePath);   // return file input stream of extracted text
    } catch (err) {
        LOG.error(`Tika error parsing file ${filepath}.`); return null;
    } finally {
        thisTikaInputStream.close(); thisOutputStream.close();
    }
}

exports.getContent = async function(filepath) {
    const readstreamTExtractedText = await exports.getContentStream(fs.createReadStream(filepath), filepath);
    return new Promise((resolve, reject) => {
        const contents = [];
        readstreamTExtractedText.on("data", chunk => contents.push(chunk));
        readstreamTExtractedText.on("close", _ => resolve(Buffer.concat(contents)));
        readstreamTExtractedText.on("error", err => reject(err));
    });
}

async function _createTikaFacade() {
    tikaconf = JSON.parse(mustache.render(await fspromises.readFile(`${__dirname}/tika.json`, "utf8"), 
        {__dirname: __dirname.split(path.sep).join(path.posix.sep)}));
    java = await calljava.getJava(tikaconf.classpath, true);
    const tikaFacadeClass = java.import("org.apache.tika.Tika"); 
    tikaFacade = new tikaFacadeClass(); 
    tikaFacade.setMaxStringLengthSync(tikaconf.max_content_length||ONE_GB_STRINGS);
}

function _copyFileToWorkingArea(inputstream, workingareaPath) {
    return new Promise((resolve, reject) => {
        const fileoutstreamTemp = fs.createWriteStream(workingareaPath);
        inputstream.on("error", err => reject(err));
        fileoutstreamTemp.on("error", err => reject(err));
        fileoutstreamTemp.on("close", _ => resolve());
        inputstream.pipe(fileoutstreamTemp);
    });
}