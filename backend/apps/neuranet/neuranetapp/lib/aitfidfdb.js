/**
 * Creates and maintains a TF.IDF search database for documents. Will not store 
 * the actual documents itself. That is for someone else to do - e.g. use metadata 
 * field to point to the actual document so when metadata is returned from a search, 
 * it can be used to locate the actual document itself.
 * 
 * The entire vocabulary and the TF.IDF data is kept in memory once loaded. Typically
 * this will match the total size of the documents. So if 4 GB of documents are ingested
 * then 4GB of RAM will be used etc. Eventually this should be sharded, eg if the data
 * is per user then each user's memory and DB should be sharded, as they are independent.
 * 
 * The module supports multiple databases, a strategy to shard would be to break logical
 * documents types into independent databases, shard them over multiple machines. This 
 * would significantly reduce per machine memory needed, and significantly boost performance.
 * 
 * Should support all international languages. Can autolearn stop words. Can autostem for 
 * multiple languages.
 * 
 * Use only get_tfidf_db factory method to init and use an instance of this module to
 * ensure proper initialization, serialization etc. Other methods are exported to allow
 * custom sharding by calling modules, if so needed.
 * 
 * _getLangNormalizedWords is the only function which depends on the actual language 
 * sematics - to split words, and take out punctuations and normalize the words.
 * 
 * Needs "natural" NPM to stem.
 * 
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */
const path = require("path");
const crypto = require("crypto");
const natural = require("natural");
const fspromises = require("fs").promises;
const jpsegmenter = require(`${__dirname}/../3p/jpsegmenter.js`);
const LOG = global.LOG || console;  // allow independent operation

const EMPTY_DB = {tfidfDocStore: {}, wordDocCounts: {}, vocabulary: []}, INDEX_FILE = "index.json", 
    VOCABULARY_FILE = "vocabulary.json", METADATA_DOCID_KEY="aidb_docid", MIN_STOP_WORD_IDENTIFICATION_LENGTH = 5,
    MIN_PERCENTAGE_COMMON_DOCS_FOR_STOP_WORDS = 0.95, DEFAULT_MAX_COORD_BOOST = 0.10;
const IN_MEM_DBS = {};

// international capable punctuation character regex from: https://stackoverflow.com/questions/7576945/javascript-regular-expression-for-punctuation-international
const PUNCTUATIONS = new RegExp(/[\$\uFFE5\^\+=`~<>{}\[\]|\u3000-\u303F!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/g);
const SPLITTERS = new RegExp(/[\s,]+/), JP_SEGMENTER = jpsegmenter.getSegmenter();

/**
 * Creates a new TF.IDF DB instance and returns it. Use this function preferably to get a new DB instance.
 * @param {string} dbPath The save path for the database
 * @param {string} metadata_docid_key The document ID key inside document metadata. Default is "aidb_docid"
 * @param {string} lang The language for the DB. Default is English.
 * @param {string} stopwords_path The path to the ISO stopwords file, if available. Format is {"iso_language_code":[array of stop words],...}
 *                                If set to null (not provided) then the DB will try to auto learn stop words.
 * @param {boolean} no_stemming Whether or not to stem the words. Default is to stem. If true stemming won't be used.
 * @param {boolean} autosave Autosave the DB or not. Default is true.
 * @param {number} autosave_frequency The autosave frequency. Default is 500 ms. 
 * @return {object} The database object.
 */
exports.get_tfidf_db = async function(dbPath, metadata_docid_key=METADATA_DOCID_KEY, lang="en", 
        stopwords_path, no_stemming=false, autosave=true, autosave_frequency=500) {
    const normPath = path.resolve(dbPath); if (!IN_MEM_DBS[normPath]) {    // load the DB from the disk only if needed
        try { await fspromises.access(dbPath); } catch (err) {    // check the DB path exists or create it etc.
            if (err.code == "ENOENT") { 
                LOG.warn(`Unable to access the TF.IDF DB store at path ${path}. Creating a new one.`); 
                await fspromises.mkdir(dbPath, {recursive: true});
            } else throw err;   // not an issue with the DB folder, something else so throw it
        }
        IN_MEM_DBS[normPath] = await exports.loadData(normPath);
    }
    const db = IN_MEM_DBS[normPath]; db.METADATA_DOCID_KEY = metadata_docid_key; db.no_stemming = no_stemming;
    if (stopwords_path) db._stopwords = require(stopwords_path)[lang];

    const _autosaveIfSelected = _ => {if (autosave) setTimeout(_=>exports.writeData(dbPath, db), autosave_frequency);}

    return {    // TODO: add stream ingestion
        create: (document, metadata, dontRebuildDB, override_lang) => {
            const result = exports.create(document, metadata, dontRebuildDB, override_lang||lang, db); 
            _autosaveIfSelected(); return result;
        },
        update: (oldmetadata, newmetadata, override_lang) => {const result = exports.update(oldmetadata, newmetadata, 
            override_lang||lang, db); _autosaveIfSelected(); return result;},
        query: (query, topK, filter_function, cutoff_score, options, override_lang) => 
            exports.query(query, topK, filter_function, override_lang||lang, cutoff_score, options, db),
        delete: (metadata, override_lang) => {const result = exports.delete(metadata, override_lang||lang, db); 
            _autosaveIfSelected(); return result;},
        defragment: db => {const result = exports.defragment(db); _autosaveIfSelected(); return result;},
        rebuild: _ => exports.rebuild(db),
        flush: _ => exports.writeData(dbPath, db)   // writeData is async so the caller can await for the flush to complete
    }
}

exports.loadData = async function(pathIn) {
    const indexFile = `${pathIn}/${INDEX_FILE}`, vocabularyFile = `${pathIn}/${VOCABULARY_FILE}`;

    let index; try {index = JSON.parse(await fspromises.readFile(indexFile, "utf8"))} catch (err) {
        LOG.error(`TF.IDF search can't find or load ${INDEX_FILE} from path ${pathIn}. Using an empty DB.`); return _deepclone(EMPTY_DB);
    };
    let vocabulary; try {vocabulary = JSON.parse(await fspromises.readFile(vocabularyFile, "utf8"));} catch (err) {
        LOG.error(`TF.IDF search can't find or load ${VOCABULARY_FILE} from path ${pathIn}. Using an empty DB.`); return _deepclone(EMPTY_DB);
    };

    return {tfidfDocStore: index.tfidfDocStore, wordDocCounts: index.wordDocCounts, vocabulary};
}

exports.writeData = async (pathIn, db) => {
    const indexFile = `${pathIn}/${INDEX_FILE}`, vocabulary = `${pathIn}/${VOCABULARY_FILE}`;

    await fspromises.writeFile(indexFile, JSON.stringify({tfidfDocStore: db.tfidfDocStore, wordDocCounts: db.wordDocCounts}));
    await fspromises.writeFile(vocabulary, JSON.stringify(db.vocabulary));
}

/**
 * Ingests a new document into the given database.
 * @param {object} document The document to ingest. Must be a text string.
 * @param {object} metadata The document's metadata. Must have document ID inside as a field - typically aidb_docid
 * @param {boolean} dontRecalculate If set to true DB won't be rebuilt, scores will be wrong. A manual rebuild must be done later.
 * @param {string} lang The language for the database, defaults to English "en". Use ISO 2 character codes.
 * @param {object} db The database to use
 * @return {object} metadata The document's metadata.
 */
exports.ingest = exports.create = function(document, metadata, dontRecalculate=false, lang="en", db=EMPTY_DB) {
    LOG.info(`Starting word extraction for ${JSON.stringify(metadata)}`);
    const docHash = _getDocumentHashIndex(metadata, lang, db), docWords = _getLangNormalizedWords(document, lang, db),
        datenow = Date.now();
    LOG.info(`Deleting old document for ${JSON.stringify(metadata)}`);
    exports.delete(metadata, lang, db);   // if adding the same document, delete the old one first.
    const newDocument = {metadata: _deepclone(metadata), scores: {}, length: docWords.length, 
        date_created: datenow, date_modified: datenow}; db.tfidfDocStore[docHash] = newDocument;
    LOG.info(`Starting word counting for ${JSON.stringify(metadata)}`);
    const docsInDB = Object.keys(db.tfidfDocStore).length, wordsCounted = {}; for (const word of docWords) {
        const wordIndex = _getWordIndex(word, db, true); 
        if (!wordsCounted[wordIndex]) {
            db.wordDocCounts[wordIndex] = Math.min(db.wordDocCounts[wordIndex]?db.wordDocCounts[wordIndex]+1:1, docsInDB);  // db.wordDocCounts can't eevr be more than number of docs in the DB
            wordsCounted[wordIndex] = true; 
        }
        if (!newDocument.scores[wordIndex]) newDocument.scores[wordIndex] = {tfidf: 0, wordcount: 1};   // see _recalculateTFIDF below
        else newDocument.scores[wordIndex].wordcount = newDocument.scores[wordIndex].wordcount+1;   
    }

    if (!dontRecalculate) exports.rebuild(db);
    return metadata;
}

exports.rebuild = db => {
    LOG.info(`Starting recalculation of TFIDS.`);
    _recalculateTFIDF(db);    // rebuild the entire TF.IDF score index for all documents, will fix the 0 scores for this document above too
    LOG.info(`Ended recalculation of TFIDS.`);
}

exports.delete = function(metadata, lang="en", db=EMPTY_DB) {
    const document = db.tfidfDocStore[_getDocumentHashIndex(metadata, lang, db)], wordCounts = _deepclone(db.wordDocCounts);
    if (document) {
        const allDocumentWordIndexes = Object.keys(document.scores);
        for (const wordIndex of allDocumentWordIndexes) {
            wordCounts[wordIndex] = wordCounts[wordIndex]-1;
            if (wordCounts[wordIndex] == 0) delete wordCounts[wordIndex];   // this makes the vocabulary a sparse index potentially but is needed otherwise word-index mapping will change breaking the entire DB
        }
        delete db.tfidfDocStore[_getDocumentHashIndex(metadata, lang, db)];
        db.wordDocCounts = wordCounts;
    }
}

exports.update = (oldmetadata, newmetadata, lang="en", db=EMPTY_DB) => {
    const oldhash = _getDocumentHashIndex(oldmetadata, lang, db), newhash = _getDocumentHashIndex(newmetadata, lang, db),
        document = db.tfidfDocStore[oldhash];
    if (!document) return false;    // not found
    document.metadata = _deepclone(newmetadata); document.date_modified = Date.now();
    delete db.tfidfDocStore[oldhash]; db.tfidfDocStore[newhash] = document; 
    return newmetadata;
}

/**
 * TF.IDF search. Formula is document_score = coord(q/Q)*sum(tfidf(q,d)) - where q is the
 * set of query words found in the document and Q is the superset of all query words. And
 * d is the document from the set D of all documents in the given database.
 * @param {string} query The query
 * @param {number} topK TopK where K is the max top documents to return. 
 * @param {function} filter_function Filter function to filter the documents, runs pre-query
 * @param {string} lang The language, defaults to "en" or English. Use ISO language codes.
 * @param {number} cutoff_score The cutoff score relative to the top document. From 0 to 1.
 * @param {object} options An object with values below
 *                  {
 *                      ignoreCoord: Do not use coord scores, 
 *                      filter_metadata_last: If set to true, then TD.IDF search is performed first, 
 *                                            then metadata filtering. Default is false,
 *                      max_coord_boost: Maximum boost from coord scores. Default is 10%.
 *                  }
 * @param {object} db The database to use
 * @returns {Array} The resulting documents as an array of {metadata, plus other stats} objects.
 */
exports.query = (query, topK, filter_function, lang="en", cutoff_score, options={}, db=EMPTY_DB) => {
    const queryWords = _getLangNormalizedWords(query, lang, db), scoredDocs = []; let highestScore = 0; 
    for (const document of Object.values(db.tfidfDocStore)) {
        if (filter_function && (!options.filter_metadata_last) && (!filter_function(document.metadata))) continue; // drop docs if they don't pass the filter
        let scoreThisDoc = 0, queryWordsFoundInThisDoc = 0; if (query) for (const queryWord of queryWords) {
            const wordIndex = _getWordIndex(queryWord, db); if (wordIndex == null) continue;  // query word not found in the vocabulary
            if (document.scores[wordIndex]) {scoreThisDoc += document.scores[wordIndex].tfidf; queryWordsFoundInThisDoc++;}
        }
        const max_coord_boost = options.max_coord_boost||DEFAULT_MAX_COORD_BOOST, 
            coordScore = (query && (!options.ignoreCoord)) ? 1+(max_coord_boost*queryWordsFoundInThisDoc/queryWords.length) : 1;
        scoreThisDoc = scoreThisDoc*coordScore; // add in coord scoring
        scoredDocs.push({metadata: document.metadata, score: scoreThisDoc, coord_score: coordScore, 
            tfidf_score: scoreThisDoc/coordScore, query_tokens_found: queryWordsFoundInThisDoc, total_query_tokens: queryWords.length}); 
        if (scoreThisDoc > highestScore) highestScore = scoreThisDoc;
    }
    let filteredScoredDocs = []; if (filter_function && options.filter_metadata_last) { for (const scoredDoc of scoredDocs)   // post-filter here if indicated
        if (filter_function(scoredDoc.metadata)) filteredScoredDocs.push(scoredDoc); } else filteredScoredDocs = scoredDocs;

    if (!query) return filteredScoredDocs;  // can't do cutoff, topK etc if no query was given
    
    filteredScoredDocs.sort((doc1, doc2) => doc1.score < doc2.score ? 1 : doc1.score > doc2.score ? -1 : 0);
    // if cutoff_score is provided, then use it. Use highest score to balance the documents found for the cutoff
    let cutoffDocs = []; if (cutoff_score) for (const scoredDocument of filteredScoredDocs) {  
        scoredDocument.cutoff_scaled_score = scoredDocument.score/highestScore; scoredDocument.highest_query_score = highestScore;
        if (scoredDocument.cutoff_scaled_score >= cutoff_score) cutoffDocs.push(scoredDocument);
    } else cutoffDocs = scoredDocs;
    const topKScoredDocs = topK ? cutoffDocs.slice(0, (topK < cutoffDocs.length ? topK : cutoffDocs.length)) : cutoffDocs;
    return topKScoredDocs;
}

exports.defragment = function(db) {
    const newVocabulary = []; for (const [wordIndex, word] of db.vocabulary.entries())
        if (db.wordDocCounts[wordIndex]) newVocabulary.push(word);  // rebuild by unsparsing the new vocabulary
    if (newVocabulary.length == db.vocabulary.length) return;   //nothing to do

    const newTFIDFDocStore = {}; for (const [documentHash, document] of Object.entries(db.tfidfDocStore)) {
        const newDocument = _deepclone(document); newDocument.scores = {};
        for (const wordIndex of Object.keys(document.scores)) {
            const word = _getDocWordFromIndex(wordIndex, db);
            const newWordIndex = _getWordIndex(word, {...db, vocabulary: newVocabulary});
            newDocument.scores[newWordIndex] = document.scores[wordIndex];
        }
        newTFIDFDocStore[documentHash] = newDocument;
    }

    const newWordDocCounts = {}; for (const [wordIndex, word] of newVocabulary.entries())
        newWordDocCounts[wordIndex] = db.wordDocCounts[_getWordIndex(word, db)];
    
    db.tfidfDocStore = newTFIDFDocStore;
    db.wordDocCounts = newWordDocCounts;
    db.vocabulary = newVocabulary;
}

function _recalculateTFIDF(db) {  // rebuilds the entire TF.IDF index for all documents, necessary as IDF changes with every new doc ingested
    for (const document of Object.values(db.tfidfDocStore)) for (const wordIndex of Object.keys(document.scores)) {
        const tf = document.scores[wordIndex].wordcount/document.length, 
            idf = 1+Math.log10(Object.keys(db.tfidfDocStore).length/(db.wordDocCounts[wordIndex]+1));
        document.scores[wordIndex].tfidf = tf*idf;
    }
}

function _getLangNormalizedWords(document, lang, db, fastSplit = true) {    
    LOG.info(`Starting getting normalized words for the document.`); 
    const words = [], segmenter = fastSplit ? {
        segment: documentIn => {
            const list = lang == "jp" ? JP_SEGMENTER.segment(documentIn) : documentIn.split(SPLITTERS);
            const retList = [];
            for (const word of list) {let norm = word.trim(); if (norm != "") retList.push({segment: norm, isWordLike: true});}
            return retList;
        }} : new Intl.Segmenter(lang, {granularity: "word"});
    const _getStemmer = lang => {
        const DEFAULT_STEMMER = {stem: word => word};   // null stemmer - not too bad still
        if (db.no_stemming) return DEFAULT_STEMMER;

        switch (lang) {
            case "en": return natural.PorterStemmer; 
            case "es": return natural.PorterStemmerEs;
            case "jp": return natural.StemmerJa;
            case "ru": return natural.PorterStemmerRu;
            case "fr": return natural.PorterStemmerFr;
            case "de": return natural.PorterStemmerDe;
            default: return DEFAULT_STEMMER;    
        }
    }
    const _isStopWord = word => {   // can auto learn stop words if needed, language agnostic
        const dbDocCount = Object.keys(db.tfidfDocStore).length;
        if ((!db._stopwords) && (dbDocCount > MIN_STOP_WORD_IDENTIFICATION_LENGTH)) {   // auto learn stop words if possible
            db._stopwords = []; for (const [thisWordIndex, thisWordDocCount] of Object.entries(db.wordDocCounts)) 
                if ((thisWordDocCount/dbDocCount) > MIN_PERCENTAGE_COMMON_DOCS_FOR_STOP_WORDS) 
                    db._stopwords.push(_getDocWordFromIndex(thisWordIndex, db));
        }
        
        if (!db._stopwords) return false;   // nothing to do
        const isStopWord = db._stopwords.includes(word); 
        return isStopWord;
    }
    for (const segmentThis of Array.from(segmenter.segment(document))) if (segmentThis.isWordLike) {
        const depuntuatedLowerLangWord = segmentThis.segment.replaceAll(PUNCTUATIONS, "").trim().toLocaleLowerCase(lang);
        if (_isStopWord(depuntuatedLowerLangWord)) continue;    // drop stop words
        const stemmedWord = _getStemmer(lang).stem(depuntuatedLowerLangWord);
        words.push(stemmedWord);
    }
    LOG.info(`Ending getting normalized words for the document.`);
    return words;
}

const _getDocumentHashIndex = (metadata, lang="en", db) => {
    if (metadata[db.METADATA_DOCID_KEY||METADATA_DOCID_KEY]) return metadata[db.METADATA_DOCID_KEY||METADATA_DOCID_KEY];
    const lowerCaseObject = {}; for (const [key, keysValue] of Object.entries(metadata))
        lowerCaseObject[key.toLocaleLowerCase?key.toLocaleLowerCase(lang):key] = 
            keysValue.toLocaleLowerCase?keysValue.toLocaleLowerCase(lang):keysValue;
    return crypto.createHash("md5").update(JSON.stringify(lowerCaseObject)).digest("hex");
}

const _getWordIndex = (word, db, create) => {
    const index = db.vocabulary.indexOf(word); if (index != -1) return index;
    if (create) {db.vocabulary.push(word); return db.vocabulary.indexOf(word);}
    else return null;
}
const _getDocWordFromIndex = (index, db) => db.vocabulary[index];
const _deepclone = object => JSON.parse(JSON.stringify(object));