/**
 * Creates a large set of files for TF.IDF or AI DB testing.
 */

const fs = require("fs");
const path = require("path");
const mustache = require("mustache");

function _getRandom(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

async function _cleanDir(pathToDir) {
    for (const file of fs.readdirSync(pathToDir)) fs.unlinkSync(path.join(pathToDir, file));
}

async function _generator(template, wordlist, outpath, numfiles) {
    for (let i = 0; i < numfiles; i++) {
        let finalDocToWrite = "";
        for (const wordlistGroupKey of Object.keys(wordlist)) {
            const wordlistGroup = wordlist[wordlistGroupKey], wordsToGen = wordlistGroup.maxwords > wordlistGroup.minwords ? 
                _getRandom(wordlistGroup.minwords, wordlistGroup.maxwords) : wordlistGroup.maxwords, 
                workingWordList = [...wordlistGroup.wordlist];
            const words = []; for (let i = 0; i < wordsToGen; i++) {
                const wordIndex = _getRandom(0, workingWordList.length-1);
                const word = workingWordList.splice(wordIndex, 1)[0];
                const wordObject = typeof word == "object" ?  
                    {groupkey: wordlistGroupKey, key:(Object.keys(word))[0], value: (Object.values(word))[0]} : 
                    {groupkey: wordlistGroupKey, key: word.toString(), value: word.toString()};
                words.push(wordObject);
            }
            finalDocToWrite += mustache.render(template, {words});
        }
        fs.writeFileSync(outpath+"/"+(i+1)+".txt", finalDocToWrite);
    }
}

if (require.main === module) {
    const argv = process.argv.splice(2);
    console.log(`Usage: ${process.argv[1]} [num of files to gen] [template path] [wordlist path] [gen output dir]`);
    const filesToGen = argv[0]?parseInt(argv[0]):100, template = argv[1]||`${__dirname}/synthetic_docs/gendata/template1.txt`,
        wordlistPath = argv[2]||`${__dirname}/synthetic_docs/gendata/wordlist.json`, gendir = argv[3]||`${__dirname}/synthetic_docs/generated`,
        wordlist = require(wordlistPath);
    console.log(`Generating ${filesToGen} files to path ${gendir}.`);
    try {_cleanDir(gendir);} catch (err) {};    // clean output
    _generator(fs.readFileSync(template, "utf8"), wordlist, gendir, filesToGen);
    console.log("Done.");
}