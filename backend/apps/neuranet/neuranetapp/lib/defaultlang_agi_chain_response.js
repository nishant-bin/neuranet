/**
 * Composes final response given code objects.
 * (C) 2023 TekMonks. All rights reserved.
 */

exports.getResponse = function(responses) {
    const codesArray = []; for (const responseObject of responses) codesArray.push(responseObject.code);
    return {codes: codesArray};
}