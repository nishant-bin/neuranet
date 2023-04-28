/**
 * Composes final response given code objects.
 * (C) 2023 TekMonks. All rights reserved.
 */

exports.getResponse = function(responses) {
    let startLine, endLine = "}";
    const codesArray = []; for (const responseObject of responses) {
        if (responseObject.context == "start") {
            const codeLines = responseObject.code.replace(/\r\n/gm, "\n").split("\n");
            startLine = codeLines[0]; codeLines.splice(0, 1); codeLines.splice(codeLines.length-1, 1);
            const codeNow = codeLines.join("\n")
            codesArray.push(codeNow);
        } else codesArray.push(responseObject.code);
    }
    const finalResponse =[startLine, ...codesArray, endLine];
    return {codes: finalResponse};
}