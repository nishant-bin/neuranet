/**
 * Language detector. Uses trigram algorithms to detect language in the
 * text.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const {detect} = require("tinyld");

exports.getISOLang = function(text) {
    const langAutoDetected = detect(text);
    if ((!langAutoDetected) || (langAutoDetected.trim()=="")) return "en";  // default to English
    else return langAutoDetected;
}