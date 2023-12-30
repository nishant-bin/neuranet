/**
 * Rephrases the document and returns the new document.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const indexdoc = require(`${NEURANET_CONSTANTS.APIDIR}/indexdoc.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const textsplitter = require(`${NEURANET_CONSTANTS.LIBDIR}/textsplitter.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`)

async function generate(fileindexer, prompt, modelObject, pathid) {
    const document = fileindexer.getContents(), langDetected = langdetector.getISOLang(document),
        split_separators = lang[langDetected]?lang[langDetected].split_separators:lang["*"].split_separators,
        splits = textsplitter.getSplits(document, modelObject.request.max_tokens, 0, split_separators);

    
    const rephrasedSplits = []; for (const split of splits) {
        const rephrasedSplit = await simplellm.prompt_answer(prompt, fileindexer.id, fileindexer.org, split, modelObject);
        if (!rephrasedSplit) return {result: false};
        rephrasedSplits.push(rephrasedSplit);
    }

    const cmspath = `${path.dirname(fileindexer.cmspath)}/${indexdoc.DYNAMIC_FILES_FOLDER}/${pathid}_${path.basename(fileindexer.cmspath)}`;
    return {result: true, contentOrReadStream: _ => rephrasedSplits.join(split_separators[0]), cmspath, langDetected, 
        comment: `${pathid}:${path.basename(fileindexer.cmspath)}`};
}

module.exports = {generate}