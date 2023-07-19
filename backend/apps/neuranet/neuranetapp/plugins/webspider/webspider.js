/**
 * Can spider a website and ingest all its documents.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

exports.canHandle = async function(fileindexer) {
    if (fileindexer.getFilePath().toLowerCase().endsWith(S_PLUGIN_EXTENSION)) {
        const fileContents = await fileindexer.getContents(filepath, additionalHandlingInformation);
        if (JSON.parse(fileContents).url) return true;  // minimally we should have URL we need to crawl
    } else return false;
}

exports.ingest = async function(fileindexer) {
    
}