/**
 * Used to extract UTF-8 text from any file. Uses text extraction plugins.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/textextractor.json`); 

exports.initAsync = async _ => {
    for (const textExtractor of conf.text_extraction_plugins) 
        if (textExtractor.initAsync) await textExtractor.initAsync();
}

exports.extractTextAsStreams = async function(inputstream, filepath) {
    for (const textExtractor of conf.text_extraction_plugins) {
        const pluginThis = NEURANET_CONSTANTS.getPlugin(textExtractor); 
        const extractedTextStream = await pluginThis.getContentStream(inputstream, filepath);
        if (extractedTextStream) return extractedTextStream;
    } 

    throw new Error(`Unable to process the given file to extract the text.`);
}