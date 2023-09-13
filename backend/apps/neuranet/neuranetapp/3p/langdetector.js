/**
 * Language detector. Uses trigram algorithms to detect language in the
 * text.
 * 
 * (C) 2023 Tekmonks 
 */

const {detect} = require("tinyld");

exports.getISOLang = function(text) {
    return detect(text);
}