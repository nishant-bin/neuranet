/**
 * Creates and maintains a TF.IDF search database for documents. Will not store 
 * the actual documents itself. That is for someone else to do - e.g. use metadata 
 * field to point to the actual document so when metadata is returned from a search, 
 * it can be used to locate the actual document itself.
 * 
 * Can use lowmem modes which implies a caching filesystem is used, while the database
 * is not kept in memory. Or a full mem mode, where the entire DB is stored in the memory.
 * Since words are compressed to tokens and counted, the memory is compressed by default.
 * Low mem mode needs Monkshu as it needs Monkshu's memfs filesystem for memory caching.
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
 * sematics - to split words, and take out punctuations and normalize the words. This
 * function needs external "natural" NPM to stem and auto-correct only English queries.
 * 
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const path = require("path");
const crypto = require("crypto");
const natural = require("natural");
const {Readable} = require("stream");
const fspromises = require("fs").promises;
const jpsegmenter = require(`${__dirname}/../3p/jpsegmenter.js`);
const zhsegmenter = require(`${__dirname}/../3p/zhsegmenter.js`);
const langdetector = require(`${__dirname}/../3p/langdetector.js`);
const LOG = global.LOG || console;  // allow independent operation
const memfs = CONSTANTS?.LIBDIR ? require(`${CONSTANTS.LIBDIR}/memfs.js`) : fspromises;  // use uncached fs if not under monkshu
const conf = require(`${NEURANET_CONSTANTS?.CONFDIR||(__dirname+"/conf")}/aidb.json`);

const WORDDOCCOUNTS_FILE = "worddoccounts", VOCABULARY_FILE = "vocabulary", METADATA_DOCID_KEY="aidb_docid", 
    MIN_STOP_WORD_IDENTIFICATION_LENGTH = 5, MIN_PERCENTAGE_COMMON_DOCS_FOR_STOP_WORDS = 0.95, 
    DEFAULT_MAX_COORD_BOOST = 0.10, METADATA_LANGID_KEY="aidb_langid";
const IN_MEM_DBS = {};

// international capable punctuation character regex from: https://stackoverflow.com/questions/7576945/javascript-regular-expression-for-punctuation-international
const PUNCTUATIONS = new RegExp(/[\$\uFFE5\^\+=`~<>{}\[\]|\u3000-\u303F!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/g);
const SPLITTERS = new RegExp(/[\s,]+/), JP_SEGMENTER = jpsegmenter.getSegmenter(), ZH_SEGMENTER = zhsegmenter.getSegmenter();

/**
 * Creates a new TF.IDF DB instance and returns it. Use this function preferably to get a new DB instance.
 * @param {string} dbPathOrMemID The save path for the database, or memory ID if in memory DB only
 * @param {string} metadata_docid_key The document ID key inside document metadata. Default is "aidb_docid"
 * @param {string} metadata_langid_key The language ID key inside document metadata. Default is "aidb_langid"
 * @param {string} stopwords_path The path to the ISO stopwords file, if available. Format is {"iso_language_code":[array of stop words],...}
 *                                If set to null (not provided) then the DB will try to auto learn stop words.
 * @param {boolean} no_stemming Whether or not to stem the words. Default is to stem. If true stemming won't be used.
 * @param {boolean} autosave Autosave the DB or not. Default is true.
 * @param {number} autosave_frequency The autosave frequency. Default is 500 ms. 
 * @param {boolean} mem_only If true, then the DB is in memory only. Default is false.
 * @param {boolean} lowmem If true, the DB is not loaded completely into the memory, 
 *                         this saves memory but will slow down the performance
 * @return {object} The database object.
 */
exports.get_tfidf_db = async function(dbPathOrMemID, metadata_docid_key=METADATA_DOCID_KEY, 
        metadata_langid_key=METADATA_LANGID_KEY, stopwords_path, no_stemming=false, mem_only=false, lowmem=true) {
    
    let dbmemid = dbPathOrMemID; if (!mem_only) {
        dbmemid = path.resolve(dbPathOrMemID); if (!IN_MEM_DBS[dbmemid]) {    // load the DB from the disk only if needed
            try { await fspromises.access(dbPathOrMemID); } catch (err) {    // check the DB path exists or create it etc.
                if (err.code == "ENOENT") { 
                    LOG.warn(`Unable to access the TF.IDF DB store at path ${path}. Creating a new one.`); 
                    await fspromises.mkdir(dbPathOrMemID, {recursive: true});
                } else throw err;   // not an issue with the DB folder, something else so throw it
            }
            IN_MEM_DBS[dbmemid] = await exports.loadData(path.resolve(dbPathOrMemID), lowmem);
        }
    } else if (!IN_MEM_DBS[dbmemid]) IN_MEM_DBS[dbmemid] = exports.emptydb();
    
    const db = IN_MEM_DBS[dbmemid]; db.METADATA_DOCID_KEY = metadata_docid_key; db.no_stemming = no_stemming;
    db.METADATA_LANGID_KEY = metadata_langid_key; if (stopwords_path) db._stopwords = require(stopwords_path);
    db.lowmem = lowmem;

    let save_timer; if (conf.autosave && (!mem_only)) save_timer = setInterval(_=>exports.writeData(dbPathOrMemID, db), conf.autosave_frequency);

    const dbObjectWrapper = {    
        create: async (document, metadata, dontRebuildDB, lang) => {
            const result = await exports.create(document, metadata, dontRebuildDB, db, lang); return result; },
        createStream: async (stream, metadata, dontRebuildDB, lang) => {
            const result = await exports.createStream(stream, metadata, dontRebuildDB, db, lang); return result; },
        update: async (oldmetadata, newmetadata) => {
            const result = await exports.update(oldmetadata, newmetadata, db); return result;},
        query: (query, topK, filter_function, cutoff_score, options, lang, autocorrect) => exports.query(query, 
            topK, filter_function, cutoff_score, options, db, lang, autocorrect),
        delete: async metadata => {
            const result = await exports.delete(metadata, db); return result; },
        defragment: async db => {
            const result = await exports.defragment(db); return result; },
        rebuild: _ => exports.rebuild(db),
        sortForTF: documents => documents.sort((doc1, doc2) => doc1.tf_score < doc2.tf_score ? 1 : 
            doc1.tf_score > doc2.tf_score ? -1 : 0),
        flush: _ => exports.writeData(dbPathOrMemID, db),      // writeData is async so the caller can await for the flush to complete
        free_memory: _ => {if (save_timer) clearInterval(save_timer); delete IN_MEM_DBS[dbmemid];}
    }; dbObjectWrapper.ingest = dbObjectWrapper.create; dbObjectWrapper.ingestStream = dbObjectWrapper.createStream;
    return dbObjectWrapper;
}

/**
 * Creates an empty DB.
 * @returns An empty DB.
 */
exports.emptydb = _ => exports.loadData();

/**
 * Loads the given database into memory and returns the DB object.
 * @param {string} pathIn The DB path
 * @param {boolean} lowmem If true, then only a portion of DB is kept in memory using LRU.
 * @returns {object} The DB loaded
 */
exports.loadData = async function(pathIn, lowmem) {
    const EMPTY_DB = {tfidfDocStore: {}, wordDocCounts: {}, vocabulary: []}; 
    const _readFileFromMemFSOrNullOnError = async hashOrPath => {
        try {return JSON.parse(await memfs.readFile(EMPTY_DB.tfidfDocStore[hashOrPath]||hashOrPath, "utf8"));} 
        catch(err) {LOG.error(`TF.IDF error reading document with hash or path ${hashOrPath}, due to ${err} returning null.`); return null;}
    }
    EMPTY_DB.tfidfDocStore.entries = _ => Object.keys(EMPTY_DB.tfidfDocStore).filter(key => 
        typeof EMPTY_DB.tfidfDocStore[key] !== "function"); 
    EMPTY_DB.tfidfDocStore.doclength = _ => EMPTY_DB.tfidfDocStore.entries().length;
    EMPTY_DB.tfidfDocStore.delete = async hash => { delete EMPTY_DB.tfidfDocStore[hash]; 
        try {await fspromises.rm(`${pathIn}/${hash}`)} catch (err) {LOG.warn(`Error deleting file ${pathIn}/${hash} for TD.IDF hash ${hash} due to ${err}.`)} };
    EMPTY_DB.tfidfDocStore.add = (hash, document) => EMPTY_DB.tfidfDocStore[hash] = document; 
    EMPTY_DB.tfidfDocStore.data = async hashOrData => typeof EMPTY_DB.tfidfDocStore[hashOrData] === "object" ? 
        EMPTY_DB.tfidfDocStore[hashOrData] : EMPTY_DB.tfidfDocStore.doclength() ? 
            _readFileFromMemFSOrNullOnError(hashOrData) : null;    // if parsed then returns object, if doc hash then the doc is read or if path, then file doc is read and returned

    if (!pathIn) return EMPTY_DB;
    const dbLoaded = EMPTY_DB; 

    const wordDocCountsFile = `${pathIn}/${WORDDOCCOUNTS_FILE}`, vocabularyFile = `${pathIn}/${VOCABULARY_FILE}`;
    let wordDocCounts; try {wordDocCounts = JSON.parse(await fspromises.readFile(wordDocCountsFile, "utf8"))} catch (err) {
        LOG.error(`TF.IDF search can't find or load ${WORDDOCCOUNTS_FILE} from path ${pathIn}. Using an empty DB.`); return dbLoaded;
    };
    let vocabulary; try {vocabulary = JSON.parse(await fspromises.readFile(vocabularyFile, "utf8"));} catch (err) {
        LOG.error(`TF.IDF search can't find or load ${VOCABULARY_FILE} from path ${pathIn}. Using an empty DB.`); return dbLoaded;
    };
    let fileEntries; try{fileEntries = await fspromises.readdir(pathIn)} catch (err) {
        LOG.error(`TF.IDF search can't find or load database directory from path ${pathIn}. Using an empty DB.`); 
        return dbLoaded; 
    };
    dbLoaded.wordDocCounts = wordDocCounts; dbLoaded.vocabulary = vocabulary;

    try {
        for (const file of fileEntries) if ((file != WORDDOCCOUNTS_FILE) && (file != VOCABULARY_FILE))  // these are our indices, so skip
            dbLoaded.tfidfDocStore.add(file, lowmem ? `${pathIn}/${file}` : JSON.parse(await fspromises.readFile(
                `${pathIn}/${file}`, "utf8"))); // not using memfs here to avoid double memory hit for no reason if lowmem is disabled
    } catch (err) {LOG.error(`TF.IDF search load document ${file} from path ${pathIn}. Skipping this document.`);};

    return dbLoaded;
}

/**
 * Serializes an in-memory DB to the disk.
 * @param {string} pathIn The path to write to
 * @param {object} db The DB to write out
 */
exports.writeData = async (pathIn, db) => {
    const worddocCountsFile = `${pathIn}/${WORDDOCCOUNTS_FILE}`, vocabulary = `${pathIn}/${VOCABULARY_FILE}`;

    await fspromises.writeFile(worddocCountsFile, JSON.stringify(db.wordDocCounts, null, 4));
    await fspromises.writeFile(vocabulary, JSON.stringify(db.vocabulary, null, 4));
    for (const dbDocHashKey of db.tfidfDocStore.entries())
        await (db.lowmem ? memfs : fspromises)["writeFile"](`${pathIn}/${dbDocHashKey}`, 
            JSON.stringify(await db.tfidfDocStore.data(dbDocHashKey), null, 4));
}

/**
 * Ingests a new document into the given database.
 * @param {object} document The document to ingest. Must be a text string.
 * @param {object} metadata The document's metadata. Must have document ID inside as a field - typically aidb_docid
 * @param {boolean} dontRecalculate If set to true DB won't be rebuilt, scores will be wrong. A manual rebuild must be done later.
 * @param {object} db The database to use
 * @param {string} lang The language for the database. Defaults to autodetected language. Use ISO 2 character codes.
 * @return {object} metadata The document's metadata.
 * @throws {Error} If the document's metadata is missing the document ID field. 
 */
exports.ingest = exports.create = function(document, metadata, dontRecalculate=false, db=exports.emptydb(), lang) {
    return exports.ingestStream(Readable.from(document), metadata, dontRecalculate, db, lang);
}

/**
 * Ingests a new document into the given database.
 * @param {object} readstream The stream to ingest. Must be a read stream.
 * @param {object} metadata The document's metadata. Must have document ID inside as a field - typically aidb_docid
 * @param {boolean} dontRecalculate If set to true DB won't be rebuilt, scores will be wrong. A manual rebuild must be done later.
 * @param {object} db The database to use
 * @param {string} lang The language for the database. Defaults to autodetected language. Use ISO 2 character codes.
 * @return {object} metadata The document's metadata.
 * @throws {Error} If the document's metadata is missing the document ID field. 
 */
exports.ingestStream = exports.createStream = async function(readstream, metadata, dontRecalculate=false, 
        db=exports.emptydb(), lang) {

    LOG.info(`Starting word extraction for ${JSON.stringify(metadata)}`);
    if ((!lang) && metadata[db.METADATA_LANGID_KEY]) lang = metadata[db.METADATA_LANGID_KEY];
    if (!metadata[db.METADATA_DOCID_KEY]) throw new Error("Missing document ID in metadata.");

    const docHash = _getDocumentHashIndex(metadata, db), datenow = Date.now();
    LOG.info(`Deleting old document for ${JSON.stringify(metadata)}`);
    await exports.delete(metadata, db);   // if adding the same document, delete the old one first.
    const newDocument = {metadata: _deepclone(metadata), scores: {}, length: 0, 
        date_created: datenow, date_modified: datenow}; db.tfidfDocStore.add(docHash, newDocument);
    LOG.info(`Starting word counting for ${JSON.stringify(metadata)}`);

    return new Promise((resolve, reject) => {
        readstream.on("data", chunk => {
            const docchunk = chunk.toString("utf8");
            if (!lang) {
                lang = langdetector.getISOLang(docchunk); 
                if (!metadata[db.METADATA_LANGID_KEY]) metadata[db.METADATA_LANGID_KEY] = lang;
                LOG.info(`Autodetected language ${lang} for ${JSON.stringify(metadata)}.`);
            }
            const docWords = _getLangNormalizedWords(docchunk, lang, db); newDocument.length += docWords.length;
            const docsInDB = db.tfidfDocStore.doclength(), wordsCounted = {}; for (const word of docWords) {
                const wordIndex = _getWordIndex(word, db, true); 
                if (!wordsCounted[wordIndex]) {
                    db.wordDocCounts[wordIndex] = Math.min(db.wordDocCounts[wordIndex]?db.wordDocCounts[wordIndex]+1:1, docsInDB);  // db.wordDocCounts can't eevr be more than number of docs in the DB
                    wordsCounted[wordIndex] = true; 
                }
                if (!newDocument.scores[wordIndex]) newDocument.scores[wordIndex] = {tfidf: 0, wordcount: 1};   // see _recalculateTFIDF below
                else newDocument.scores[wordIndex].wordcount = newDocument.scores[wordIndex].wordcount+1;   
            }
        });

        readstream.on("end", async _ => {
            if (!dontRecalculate) await exports.rebuild(db);
            resolve(metadata);
        });

        readstream.on("error", async error => {
            LOG.info(`Error ingesting ${JSON.stringify(metadata)} due to error ${error.toString()}.`);
            await exports.delete(metadata, db); reject(error);
        });
    });
}

/**
 * Rebuilds the database, fixing IDF scores in particular. 
 * @param {object} db The database to rebuild.
 */
exports.rebuild = async db => {
    LOG.info(`Starting recalculation of TFIDS.`);
    await _recalculateTFIDF(db);    // rebuild the entire TF.IDF score index for all documents, will fix the 0 scores for this document above too
    LOG.info(`Ended recalculation of TFIDS.`);
}

/**
 * Deletes the given document from the database.
 * @param {object} metadata The metadata for the document to delete.
 * @param {object} db The incoming database
 */
exports.delete = async function(metadata, db=exports.emptydb()) {
    const document = await db.tfidfDocStore.data(_getDocumentHashIndex(metadata, db)), wordCounts = _deepclone(db.wordDocCounts);
    if (document) {
        const allDocumentWordIndexes = Object.keys(document.scores);
        for (const wordIndex of allDocumentWordIndexes) {
            wordCounts[wordIndex] = wordCounts[wordIndex]-1;
            if (wordCounts[wordIndex] == 0) delete wordCounts[wordIndex];   // this makes the vocabulary a sparse index potentially but is needed otherwise word-index mapping will change breaking the entire DB
        }
        await db.tfidfDocStore.delete(_getDocumentHashIndex(metadata, db));
        db.wordDocCounts = wordCounts;
    }
}

/**
 * Updates the database by replacing metadata for given documents.
 * @param {object} oldmetadata The old metadata - used to locate the document.
 * @param {object} newmetadata The new metadata
 * @param {object} db The database to operate on
 * @returns 
 */
exports.update = async (oldmetadata, newmetadata, db=exports.emptydb()) => {
    const oldhash = _getDocumentHashIndex(oldmetadata, db), newhash = _getDocumentHashIndex(newmetadata, db),
        document = await db.tfidfDocStore.data(oldhash);
    if (!document) return false;    // not found
    document.metadata = _deepclone(newmetadata); document.date_modified = Date.now();
    await db.tfidfDocStore.delete(oldhash); db.tfidfDocStore.add(newhash, document); 
    return newmetadata;
}

/**
 * TF.IDF search. Formula is document_score = coord(q/Q)*sum(tfidf(q,d)) - where q is the
 * set of query words found in the document and Q is the superset of all query words. And
 * d is the document from the set D of all documents in the given database.
 * @param {string} query The query
 * @param {number} topK TopK where K is the max top documents to return. 
 * @param {function} filter_function Filter function to filter the documents, runs pre-query
 * @param {number} cutoff_score The cutoff score relative to the top document. From 0 to 1.
 * @param {object} options An object with values below
 *                  {
 *                      ignoreCoord: Do not use coord scores, 
 *                      filter_metadata_last: If set to true, then TD.IDF search is performed first, 
 *                                            then metadata filtering. Default is false,
 *                      max_coord_boost: Maximum boost from coord scores. Default is 10%.
 *                  }
 * @param {object} db The database to use
 * @param {string} lang The language for the query, if set to null it is auto-detected
 * @param {boolean} autocorrect Whether to autocorrect query's spelling mistakes, only works for English
 * @returns {Array} The resulting documents as an array of {metadata, plus other stats} objects.
 */
exports.query = async (query, topK, filter_function, cutoff_score, options={}, db=exports.emptydb(), 
        lang, autocorrect=true) => {

    const queryWords = _getLangNormalizedWords(query, lang||langdetector.getISOLang(query), db, autocorrect), 
        scoredDocs = []; 
    let highestScore = 0; 
    for (const documentIndex of db.tfidfDocStore.entries()) {
        const document = await db.tfidfDocStore.data(documentIndex);
        if (filter_function && (!options.filter_metadata_last) && (!filter_function(document.metadata))) continue; // drop docs if they don't pass the filter
        let scoreThisDoc = 0, tfScoreThisDoc = 0, queryWordsFoundInThisDoc = 0; if (query) for (const queryWord of queryWords) {
            const wordIndex = _getWordIndex(queryWord, db); if (wordIndex == null) continue;  // query word not found in the vocabulary
            if (document.scores[wordIndex]) {tfScoreThisDoc += document.scores[wordIndex].tf; scoreThisDoc += document.scores[wordIndex].tfidf; queryWordsFoundInThisDoc++;}
        }
        const max_coord_boost = options.max_coord_boost||DEFAULT_MAX_COORD_BOOST, 
            coordScore = (query && (!options.ignoreCoord)) ? 1+(max_coord_boost*queryWordsFoundInThisDoc/queryWords.length) : 1;
        scoreThisDoc = scoreThisDoc*coordScore; // add in coord scoring
        scoredDocs.push({metadata: document.metadata, score: scoreThisDoc, coord_score: coordScore, tf_score: tfScoreThisDoc,
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

/**
 * Defragments the database. Over a period of time the vocabulary can contain words
 * which no document has. Defragmenting will drop those and improve memory and performance.
 * @param {object} db The DB to defragment
 */
exports.defragment = async function(db) {
    const newVocabulary = []; for (const [wordIndex, word] of db.vocabulary.entries())
        if (db.wordDocCounts[wordIndex]) newVocabulary.push(word);  // rebuild by unsparsing the new vocabulary
    if (newVocabulary.length == db.vocabulary.length) return;   //nothing to do

    db = exports.emptydb();
    for (const documentHash of db.tfidfDocStore.entries()) {
        const document = await db.tfidfDocStore.data(documentHash);
        const newDocument = _deepclone(document); newDocument.scores = {};
        for (const wordIndex of Object.keys(document.scores)) {
            const word = _getDocWordFromIndex(wordIndex, db);
            const newWordIndex = _getWordIndex(word, {...db, vocabulary: newVocabulary});
            newDocument.scores[newWordIndex] = document.scores[wordIndex];
        }
        db.tfidfDocStore.add(documentHash, newDocument);
    }

    const newWordDocCounts = {}; for (const [wordIndex, word] of newVocabulary.entries())
        newWordDocCounts[wordIndex] = db.wordDocCounts[_getWordIndex(word, db)];
    
    db.wordDocCounts = newWordDocCounts;
    db.vocabulary = newVocabulary;
}

async function _recalculateTFIDF(db) {  // rebuilds the entire TF.IDF index for all documents, necessary as IDF changes with every new doc ingested
    for (const documentHash of db.tfidfDocStore.entries()) {
        const document = await db.tfidfDocStore.data(documentHash);
        for (const wordIndex of Object.keys(document.scores)) {
            const tf = document.scores[wordIndex].wordcount/document.length, 
                idf = 1+Math.log10(db.tfidfDocStore.doclength()/(db.wordDocCounts[wordIndex]+1));
            document.scores[wordIndex].tfidf = tf*idf; document.scores[wordIndex].tf = tf;
        }
    }
}

function _getLangNormalizedWords(document, lang, db, autocorrect=false, fastSplit=true) {    
    LOG.info(`Starting getting normalized words for the document.`); 
    const words = [], segmenter = fastSplit ? {
        segment: documentIn => {
            const list = lang == "ja" ? JP_SEGMENTER.segment(documentIn) : lang == "zh" ? 
                ZH_SEGMENTER.segment(documentIn, true) : documentIn ? documentIn.split(SPLITTERS) : "";
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
            case "ja": return natural.StemmerJa;
            case "ru": return natural.PorterStemmerRu;
            case "fr": return natural.PorterStemmerFr;
            case "de": return natural.PorterStemmerDe;
            case "zh": return DEFAULT_STEMMER;  // ZH segmenter already converts synonyms
            default: return DEFAULT_STEMMER;    
        }
    }
    const _isStopWord = word => {   // can auto learn stop words if needed, language agnostic
        if (word.trim() == "") return true; // emptry words are useless
        const dbDocCount = db.tfidfDocStore.doclength(), dbHasStopWords = db._stopwords?.[lang] && db._stopwords[lang].length > 0;
        if ((!dbHasStopWords) && (dbDocCount > MIN_STOP_WORD_IDENTIFICATION_LENGTH)) {   // auto learn stop words if possible
            if (!db._stopwords) db._stopwords = {}; db._stopwords.lang = [];
            for (const [thisWordIndex, thisWordDocCount] of Object.entries(db.wordDocCounts)) 
                if ((thisWordDocCount/dbDocCount) > MIN_PERCENTAGE_COMMON_DOCS_FOR_STOP_WORDS) 
                    db._stopwords[lang].push(_getDocWordFromIndex(thisWordIndex, db));
        }
        
        if (!db._stopwords?.[lang]) return false;   // nothing to do
        const isStopWord = db._stopwords[lang].includes(word); 
        return isStopWord;
    }
    // currently autocorrect is only supported for English
    const correctwords = autocorrect && lang=="en", spellcheck = correctwords ? new natural.Spellcheck(db.vocabulary) : undefined;
    for (const segmentThis of Array.from(segmenter.segment(document))) if (segmentThis.isWordLike) {
        const depuntuatedLowerLangWord = segmentThis.segment.replaceAll(PUNCTUATIONS, "").trim().toLocaleLowerCase(lang);
        if (_isStopWord(depuntuatedLowerLangWord)) continue;    // drop stop words
        let stemmedWord = _getStemmer(lang).stem(depuntuatedLowerLangWord);
        if (correctwords && (!_getWordIndex(stemmedWord, db))) {
            const correctedWord = spellcheck.getCorrections(stemmedWord, 1)[0];
            if (correctedWord && _getWordIndex(correctedWord, db)) stemmedWord = correctedWord;
        } 
        words.push(stemmedWord);
    }
    LOG.info(`Ending getting normalized words for the document.`);
    return words;
}

const _getDocumentHashIndex = (metadata, db) => {
    const lang = metadata[db.METADATA_LANGID_KEY||METADATA_LANGID_KEY]||"en";
    if (metadata[db.METADATA_DOCID_KEY||METADATA_DOCID_KEY]) return metadata[db.METADATA_DOCID_KEY||METADATA_DOCID_KEY]; 
    else {  // hash the object otherwise
        const lowerCaseObject = {}; for (const [key, keysValue] of Object.entries(metadata))
            lowerCaseObject[key.toLocaleLowerCase?key.toLocaleLowerCase(lang):key] = 
                keysValue.toLocaleLowerCase?keysValue.toLocaleLowerCase(lang):keysValue;
        return crypto.createHash("md5").update(JSON.stringify(lowerCaseObject)).digest("hex");
    }
}

const _getWordIndex = (word, db, create) => {
    const index = db.vocabulary.indexOf(word); if (index != -1) return index;
    if (create) {db.vocabulary.push(word); return db.vocabulary.indexOf(word);}
    else return null;
}
const _getDocWordFromIndex = (index, db) => db.vocabulary[index];
const _deepclone = object => JSON.parse(JSON.stringify(object));