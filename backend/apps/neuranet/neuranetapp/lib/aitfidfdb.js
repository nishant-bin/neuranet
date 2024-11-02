/**
 * Creates and maintains a TF.IDF search database for documents. Will not store 
 * the actual documents itself. That is for someone else to do - e.g. use metadata 
 * field to point to the actual document so when metadata is returned from a search, 
 * it can be used to locate the actual document itself.
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
const memfs = require(`${CONSTANTS.LIBDIR}/memfs.js`);
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/aidb.json`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const jpsegmenter = require(`${__dirname}/../3p/jpsegmenter.js`);
const zhsegmenter = require(`${__dirname}/../3p/zhsegmenter.js`);
const langdetector = require(`${__dirname}/../3p/langdetector.js`);

const VOCABULARY_FILE="vocabulary", IINDEX_FILE="iindex", METADATA_DOCID_KEY="docid.key", 
    METADATA_LANGID_KEY="langid.key", METADATA_DOCID_KEY_DEFAULT = "aidb_docid", METADATA_LANGID_KEY_DEFAULT = "aidb_langid", 
    MIN_STOP_WORD_IDENTIFICATION_LENGTH = 5, MIN_PERCENTAGE_COMMON_DOCS_FOR_STOP_WORDS = 0.95, 
    DEFAULT_MAX_COORD_BOOST = 0.10, TFIDFDB_DELETE_DOC_TOPIC = "tfidf.rmdoc",
    TFIDFDB_UPDATE_DOC_TOPIC = "tfidf.updatedoc", TFIDFDB_INTERNAL_FUNCTION_CALL_TOPIC = "tfidf.functioncall";
const IN_MEM_DBS = {}; let blackboard_initialized = false;

// international capable punctuation character regex from: https://stackoverflow.com/questions/7576945/javascript-regular-expression-for-punctuation-international
const PUNCTUATIONS = new RegExp(/[\$\uFFE5\^\+=`~<>{}\[\]|\u3000-\u303F!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/g);
const SPLITTERS = new RegExp(/[\s,\.]+/), JP_SEGMENTER = jpsegmenter.getSegmenter(), ZH_SEGMENTER = zhsegmenter.getSegmenter();

/**
 * Creates a new TF.IDF DB instance and returns it. Use this function preferably to get a new DB instance.
 * @param {string} dbPathOrMemID The save path for the database, or memory ID if in memory DB only
 * @param {string} metadata_docid_key The document ID key inside document metadata. Default is "aidb_docid"
 * @param {string} metadata_langid_key The language ID key inside document metadata. Default is "aidb_langid"
 * @param {string} stopwords_path The path to the ISO stopwords file, if available. Format is {"iso_language_code":[array of stop words],...}
 *                                If set to null (not provided) then the DB will try to auto learn stop words.
 * @param {boolean} no_stemming Whether or not to stem the words. Default is to stem. If true stemming won't be used.
 * @param {boolean} mem_only If true, then the DB is in memory only. Default is false.
 * @return {object} The database object.
 */
exports.get_tfidf_db = async function(dbPathOrMemID, metadata_docid_key=METADATA_DOCID_KEY_DEFAULT, 
        metadata_langid_key=METADATA_LANGID_KEY_DEFAULT, stopwords_path, no_stemming=false, mem_only=false) {

    if (!blackboard_initialized) {_initBlackboardHooks(); blackboard_initialized = true;}

    const dbmemid = mem_only ? dbPathOrMemID : path.resolve(dbPathOrMemID);
    const dbLoadedInMemAlready = IN_MEM_DBS[dbmemid] ? true : false;
    if (!dbLoadedInMemAlready) IN_MEM_DBS[dbmemid] = await exports.emptydb(dbPathOrMemID, metadata_docid_key, 
        metadata_langid_key, stopwords_path, no_stemming, mem_only); 
    
    if ((!mem_only) && (!dbLoadedInMemAlready)) try {   // load the DB from the disk only if needed
        await memfs.access(dbPathOrMemID); await exports.loadData(dbmemid, IN_MEM_DBS[dbmemid]);
    } catch (err) {    // check the DB path exists or create it etc.
        if (err.code == "ENOENT") { 
            LOG.warn(`Unable to access the TF.IDF DB store at path ${dbPathOrMemID}. Creating a new one.`); 
            await memfs.mkdir(dbPathOrMemID, {recursive: true});   // empty DB, as it is new
        } else throw err;   // not an issue with the DB folder, something else so throw it
    } 

    // setup autosave if config has indicated for us to auto-save
    let save_timer; if (conf.autosave && (!mem_only)) save_timer = setInterval(_=>exports.writeData(dbPathOrMemID, db), conf.autosave_frequency);

    const db = IN_MEM_DBS[dbmemid], dbObjectWrapper = {     // convert DB to a wrapped object to return back  
        create: async (document, metadata, lang) => {
            const result = await exports.create(document, metadata, db, lang); return result; },
        createStream: async (stream, metadata, lang) => {
            const result = await exports.createStream(stream, metadata, db, lang); return result; },
        update: async (oldmetadata, newmetadata) => {
            const result = await exports.update(oldmetadata, newmetadata, db); return result;},
        query: (query, topK, filter_function, cutoff_score, options, lang, autocorrect) => exports.query(query, 
            topK, filter_function, cutoff_score, options, db, lang, autocorrect),
        delete: async metadata => {
            const result = await exports.delete(metadata, db); return result; },
        sortForTF: documents => documents.sort((doc1, doc2) => doc1.tf_score < doc2.tf_score ? 1 : 
            doc1.tf_score > doc2.tf_score ? -1 : 0),
        sortForCoord: documents => documents.sort((doc1, doc2) => doc1.coord_score < doc2.coord_score ? 1 : 
            doc1.coord_score > doc2.coord_score ? -1 : 0),
        flush: _ => exports.writeData(dbPathOrMemID, db),      // writeData is async so the caller can await for the flush to complete
        free_memory: _ => {if (save_timer) clearInterval(save_timer); delete IN_MEM_DBS[dbmemid];},
        _getRawDB: _ => db
    }; dbObjectWrapper.ingest = dbObjectWrapper.create; dbObjectWrapper.ingestStream = dbObjectWrapper.createStream;
    return dbObjectWrapper;
}

/**
 * Creates an empty DB.
 * @returns An empty DB.
 */
exports.emptydb = async (dbPathOrMemID, metadata_docid_key=METADATA_DOCID_KEY_DEFAULT, 
        metadata_langid_key=METADATA_LANGID_KEY_DEFAULT, stopwords_path, no_stemming=false, mem_only=false) => {

    const EMPTY_DB = {tfidfDocStore: {}, iindex: {}, distributed: conf.distributed}; 
    EMPTY_DB.tfidfDocStore.localDocumentHashes = _ => Object.keys(EMPTY_DB.tfidfDocStore).filter(key => 
        typeof EMPTY_DB.tfidfDocStore[key] !== "function"); 
    EMPTY_DB.tfidfDocStore.allDocumentHashes = async local => {
        const allDocumentHashes = EMPTY_DB.tfidfDocStore.localDocumentHashes();
        if ((!local) && EMPTY_DB.distributed) {
            const documentHashesReplies = await _getDistributedResultFromFunction(EMPTY_DB, "tfidfDocStore", "allDocumentHashes");
            for (const documentHashesReply of documentHashesReplies) allDocumentHashes.concat(documentHashesReply);
        }
        return allDocumentHashes;
    }
    EMPTY_DB.tfidfDocStore.totalDocsInDB = async local => (await EMPTY_DB.tfidfDocStore.allDocumentHashes(local)).length;
    EMPTY_DB.tfidfDocStore.localDelete = async documentHash => { 
        delete EMPTY_DB.tfidfDocStore[documentHash]; if (!EMPTY_DB.mem_only) {
            const pathOnDisk = `${EMPTY_DB.pathOrMemID}/${documentHash}`;
            try {await memfs.rm(pathOnDisk)} catch (err) {
                LOG.warn(`Error deleting file ${pathOnDisk} for TD.IDF hash ${documentHash} due to ${err}.`); }
        }
    };
    EMPTY_DB.tfidfDocStore.localAdd = (documentHash, document) => EMPTY_DB.tfidfDocStore[documentHash] = document; 
    EMPTY_DB.tfidfDocStore.localdata = documentHash => EMPTY_DB.tfidfDocStore[documentHash];
    EMPTY_DB.tfidfDocStore.data = async (documentHash, local) => {
        if (EMPTY_DB.tfidfDocStore[documentHash]) return EMPTY_DB.tfidfDocStore[documentHash];
        else if ((!local) && EMPTY_DB.distributed) {
            const dataReplies = await _getDistributedResultFromFunction(EMPTY_DB, "tfidfDocStore", "data", [documentHash]);
            for (const dataReply of dataReplies) if (dataReply) return dataReply;
            return undefined;
        }
    }
    EMPTY_DB.iindex.addLocalWordObject = (word, wordObject) => EMPTY_DB.iindex[word] = wordObject;
    EMPTY_DB.iindex.deleteLocalDocumentFromWordObject = (wordObject, documentHash) => delete wordObject.docs[documentHash];
    EMPTY_DB.iindex.getLocalWordObjectCountForDocument = (wordObject, documentHash) => wordObject.docs[documentHash];
    EMPTY_DB.iindex.addLocalDocumentForWordObject = (wordObject, documentHash, countofThisWordInDoc) => {
        const word = wordObject.word, wordObjectNew = serverutils.clone(wordObject);
        wordObjectNew.docs[documentHash] = countofThisWordInDoc; EMPTY_DB.iindex[word] = wordObjectNew;
    }
    EMPTY_DB.iindex.incrementLocalWordDocumentCount = (word, documentHash) => {
        const wordObject = EMPTY_DB.iindex[word]||{docs:{}, word};
        if (!wordObject.docs[documentHash]) wordObject.docs[documentHash] = 1; else wordObject.docs[documentHash]++;
        EMPTY_DB.iindex[word] = wordObject;
    }
    EMPTY_DB.iindex.getWordCountForDocument = async (word, documentHash, local) => {
        if (EMPTY_DB.iindex[word]?.docs[documentHash]) return EMPTY_DB.iindex[word].docs[documentHash];
        else if ((!local) && EMPTY_DB.distributed) {
            const wordcountReplies = await _getDistributedResultFromFunction(EMPTY_DB, "iindex", "getWordCountForDocument", [word, documentHash]);
            for (const wordcountReply of wordcountReplies) if (wordcountReply) return wordcountReply;
            return 0;
        } else return 0;
    }
    EMPTY_DB.iindex.getCountOfLocalDocumentsWithWord = word => {
        return EMPTY_DB.iindex[word]?Object.keys(EMPTY_DB.iindex[word].docs).length:0;
    }
    EMPTY_DB.iindex.getCountOfDocumentsWithWords = async (words, local) => {
        const localDocWordCounts = {}; for (const word of words) localDocWordCounts[word] = 
            await EMPTY_DB.iindex.getCountOfLocalDocumentsWithWord(word, true);
        const finalDocWordCounts = {...localDocWordCounts}; if ((!local) && EMPTY_DB.distributed) {
            const wordcountReplies = await _getDistributedResultFromFunction(EMPTY_DB, "iindex", "getCountOfDocumentsWithWords", [words]);
            for (const word of words) for (const wordcountReply of wordcountReplies)
                finalDocWordCounts[word] += wordcountReply[word]||0;
        }
        return finalDocWordCounts;
    }
    EMPTY_DB.iindex.isWordInVocabulary = async (word, local) => {
        if (EMPTY_DB.iindex[word]) return true; // we know of this locally already
        if ((!local) && EMPTY_DB.distributed) {
            const vocabularyReplies = await _getDistributedResultFromFunction(EMPTY_DB, "iindex", "isWordInVocabulary", [word]);
            for (const vocabularyReply of vocabularyReplies) if (vocabularyReply) return true;
            return false;
        } else return false;
    }
    EMPTY_DB.iindex.isWordInLocalVocabulary = async word => EMPTY_DB.iindex[word] != undefined && EMPTY_DB.iindex[word] != null;
    EMPTY_DB.iindex.getAllLocalWordObjects = _ => Object.values(EMPTY_DB.iindex).filter(value => typeof value !== "function");
    EMPTY_DB.iindex.getAllLocalWords = _ => Object.keys(EMPTY_DB.iindex).filter(key => typeof EMPTY_DB.iindex[key] !== "function");
    EMPTY_DB.iindex.getDocumentHashesForWord = async (word, local) => {
        const hashes = Object.keys(EMPTY_DB.iindex[word]?.docs||{}); 
        if ((!local) && EMPTY_DB.distributed) {
            const otherHashesReplies = await _getDistributedResultFromFunction(EMPTY_DB, "iindex", "getDocumentHashesForWord", [word]);
            for (const otherHashesReply of otherHashesReplies) hashes.concat(otherHashesReply);
        }
        return hashes;
    }
    
    EMPTY_DB[METADATA_DOCID_KEY] = metadata_docid_key; EMPTY_DB.no_stemming = no_stemming;
    EMPTY_DB[METADATA_LANGID_KEY] = metadata_langid_key; if (stopwords_path) EMPTY_DB._stopwords = require(stopwords_path);
    EMPTY_DB.pathOrMemID = dbPathOrMemID; EMPTY_DB.stopwords_path = stopwords_path; EMPTY_DB.mem_only = mem_only;
    return EMPTY_DB;
}

/**
 * Loads the given database into memory and returns the DB object.
 * @param {string} pathIn The DB path
 * @param {dbToLoad} object The DB to load into
 * @returns {object} The DB loaded 
 */
exports.loadData = async function(pathIn, dbToLoad) {
    let fileEntries, iindexNDJSON; try{
        fileEntries = await memfs.readdir(pathIn); iindexNDJSON = await memfs.readFile(`${pathIn}/${IINDEX_FILE}`, {encoding: "utf8"});
    } catch (err) {
        LOG.error(`TF.IDF search can't find or load database directory from path ${pathIn}. Using an empty DB.`); 
        return dbToLoad; 
    }

    for (const line of iindexNDJSON.split("\n")) {   // read the iindex
        try {
            const wordObject = JSON.parse(line); 
            dbToLoad.iindex.addLocalWordObject(wordObject.word, wordObject);
        } catch (err) { LOG.error(`Corrupted iindex due to line ${line}. Skipping this line.`); }
    }

    try {
        for (const file of fileEntries) if ((file != IINDEX_FILE) && (file != VOCABULARY_FILE)) { // these are our indices, so skip
            try {
                const document = JSON.parse(await memfs.readFile(`${pathIn}/${file}`, {encoding: "utf8"}));
                dbToLoad.tfidfDocStore.localAdd(_getDocumentHashIndex(document.metadata, dbToLoad), document); 
            } catch (err) { LOG.error(`Corrupted document found at ${`${pathIn}/${file}`}. Skipping this document.`); }
        }
    } catch (err) {LOG.error(`TF.IDF search load document ${file} from path ${pathIn}. Skipping this document.`);};

    return dbToLoad;
}

/**
 * Serializes an in-memory DB to the disk.
 * @param {string} pathIn The path to write to
 * @param {object} db The DB to write out
 */
exports.writeData = async (pathIn, db) => {
    let iindexNDJSON = ""; for (const wordObject of db.iindex.getAllLocalWordObjects()) iindexNDJSON += JSON.stringify(wordObject)+"\n";
    const memfsWritePromises = [];
    memfsWritePromises.push(memfs.writeFile(`${pathIn}/${IINDEX_FILE}`, iindexNDJSON));
    memfsWritePromises.push(memfs.writeFile(`${pathIn}/${VOCABULARY_FILE}`, JSON.stringify(db.iindex.getAllLocalWords(), null, 1))); // we don't use this, only serialized as FYI
    for (const dbDocHashKey of db.tfidfDocStore.localDocumentHashes()) memfsWritePromises.push(memfs.writeFile(
        `${pathIn}/${dbDocHashKey}`, JSON.stringify(await db.tfidfDocStore.localdata(dbDocHashKey), null, 4)));
    try {await Promise.all(memfsWritePromises);} catch (err) {
        LOG.error(`Error ${err} in writing to disk via memfs for TF.IDF DB.`);
    } finally {await memfs.flush();}
}

/**
 * Ingests a new document into the given database.
 * @param {object} document The document to ingest. Must be a text string.
 * @param {object} metadata The document's metadata. Must have document ID inside as a field - typically aidb_docid
 * @param {object} db The database to use
 * @param {string} lang The language for the database. Defaults to autodetected language. Use ISO 2 character codes.
 * @return {object} metadata The document's metadata.
 * @throws {Error} If the document's metadata is missing the document ID field. 
 */
exports.ingest = exports.create = async function(document, metadata, db, lang) {
    return await exports.ingestStream(Readable.from(document), metadata, db, lang);
}

/**
 * Ingests a new document into the given database.
 * @param {object} readstream The stream to ingest. Must be a read stream.
 * @param {object} metadata The document's metadata. Must have document ID inside as a field - typically aidb_docid
 * @param {object} db The database to use
 * @param {string} lang The language for the database. Defaults to autodetected language. Use ISO 2 character codes.
 * @return {object} metadata The document's metadata.
 * @throws {Error} If the document's metadata is missing the document ID field. 
 */
exports.ingestStream = exports.createStream = async function(readstream, metadata, db, lang) {

    LOG.info(`Starting word extraction for ${JSON.stringify(metadata)}`);
    if ((!lang) && metadata[db[METADATA_LANGID_KEY]]) lang = metadata[db[METADATA_LANGID_KEY]];
    if (!metadata[db[METADATA_DOCID_KEY]]) throw new Error("Missing document ID in metadata.");

    const docHash = _getDocumentHashIndex(metadata, db), datenow = Date.now();
    LOG.info(`Deleting old document for ${JSON.stringify(metadata)}`);
    await exports.delete(metadata, db);   // if adding the same document, delete the old one first, will do a distributed delete as well automatically
    const newDocument = {metadata: _deepclone(metadata), length: 0, date_created: datenow, date_modified: datenow}; 
    db.tfidfDocStore.localAdd(docHash, newDocument); // add to the local DB
    LOG.info(`Starting word counting for ${JSON.stringify(metadata)}`);

    return new Promise((resolve, reject) => {
        readstream.on("data", async chunk => {
            const docchunk = chunk.toString("utf8");
            if (!lang) {
                lang = langdetector.getISOLang(docchunk); 
                if (!metadata[db[METADATA_LANGID_KEY]]) metadata[db[METADATA_LANGID_KEY]] = lang;
                LOG.info(`Autodetected language ${lang} for ${JSON.stringify(metadata)}.`);
            }
            const docWords = _getLangNormalizedWords(docchunk, lang, db); newDocument.length += docWords.length;
            for (const word of docWords) db.iindex.incrementLocalWordDocumentCount(word, docHash);
        });

        readstream.on("end", _ => resolve(metadata));

        readstream.on("error", async error => {
            LOG.info(`Error ingesting ${JSON.stringify(metadata)} due to error ${error.toString()}.`);
            await exports.delete(metadata, db); reject(error);
        });
    });
}

/**
 * Deletes the given document from the database.
 * @param {object} metadata The metadata for the document to delete.
 * @param {object} db The incoming database
 * @param {boolean} publish Update other cluster members
 */
exports.delete = async function(metadata, db, publish=true) {
    const docHash = _getDocumentHashIndex(metadata, db), document = await db.tfidfDocStore.data(docHash, true);
    
    if (document) {
        for (const wordObject of db.iindex.getAllLocalWordObjects()) db.iindex.deleteLocalDocumentFromWordObject(wordObject, docHash);
        db.tfidfDocStore.localDelete(_getDocumentHashIndex(metadata, db));       // we don't await as it causes multi-threading for cascading deletes, the await is only to delete the text file which doesn't matter much
    } else if (publish) {
        const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;
        blackboard.publish(TFIDFDB_DELETE_DOC_TOPIC, {creation_data: _createDBCreationData(db), metadata}, bboptions);  // not found here, but maybe other DBs have it
    }

    return metadata;
}

/**
 * Updates the database by replacing metadata for given documents.
 * @param {object} oldmetadata The old metadata - used to locate the document.
 * @param {object} newmetadata The new metadata
 * @param {object} db The database to operate on
 * @param {boolean} publish Update other cluster members
 * @returns 
 */
exports.update = async (oldmetadata, newmetadata, db, publish=true) => {
    const oldhash = _getDocumentHashIndex(oldmetadata, db), newhash = _getDocumentHashIndex(newmetadata, db),
        document = await db.tfidfDocStore.data(oldhash, true);
    if ((!document) && publish) {
        const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;
        blackboard.publish(TFIDFDB_UPDATE_DOC_TOPIC, {creation_data: _createDBCreationData(db), 
            oldmetadata, newmetadata}, bboptions);
        return true;    // not found here, but maybe other DBs have it
    }

    document.metadata = _deepclone(newmetadata); document.date_modified = Date.now();

    await db.tfidfDocStore.localDelete(oldhash); db.tfidfDocStore.localAdd(newhash, document); 
    for (const wordObject of db.iindex.getAllLocalWordObjects()) {
        const countofThisWordInDoc = db.iindex.getLocalWordObjectCountForDocument(wordObject, oldhash);
        if (countofThisWordInDoc) {
            db.iindex.deleteLocalDocumentFromWordObject(wordObject, oldhash);
            db.iindex.addLocalDocumentForWordObject(wordObject, newhash, countofThisWordInDoc);
        }
    }

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
 *                      ignore_coord: Do not use coord scores, true or false, 
 *                      filter_metadata_last: If set to true, then TD.IDF search is performed first, 
 *                                            then metadata filtering. Default is false,
 *                      max_coord_boost: Maximum boost from coord scores. Default is 10%.,
 *                      punish_verysmall_documents: If set to true then very small documents are punished 
 *                                                  as their total information content may be small
 *                      bm25: use the BM25 algorithm 
 *                  }
 * @param {object} db The database to use
 * @param {string} lang The language for the query, if set to null it is auto-detected
 * @param {boolean} autocorrect Whether to autocorrect query's spelling mistakes, only works for English
 * @returns {Array} The resulting documents as an array of {metadata, plus other stats} objects.
 */
exports.query = async (query, topK, filter_function, cutoff_score, options={}, db, lang, autocorrect=true) => {
    const scoredDocs = []; 

    if (!query) {   // no query -> no need to score
        for (const documentHash of db.tfidfDocStore.allDocumentHashes()) {
            const document = await db.tfidfDocStore.data(documentHash);
            if (filter_function && (!filter_function(document.metadata))) continue; // drop docs if they don't pass the filter
            scoredDocs.push({metadata: document.metadata, score: 0, coord_score: 0, tf_score: 0,
                tfidf_score: 0, query_tokens_found: 0, total_query_tokens: 0});
        } 
        return scoredDocs;  // can't do cutoff, topK etc if no query was given
    } 
    
    const queryWords = _getLangNormalizedWords(query, lang||langdetector.getISOLang(query), db, autocorrect), relevantDocs = [];
    let highestScore = 0; 
    for (const queryWord of queryWords) {const docHashesWithThisWord = await db.iindex.getDocumentHashesForWord(queryWord); 
        for (const docHash of docHashesWithThisWord) if (!relevantDocs.includes(docHash)) relevantDocs.push(docHash)};
    for (const docHash of relevantDocs) {
        const document = await db.tfidfDocStore.data(docHash); if (!document) {LOG.warn(`Document is null for hash ${docHash}, ignoring.`); continue;}
        if (filter_function && (!options.filter_metadata_last) && (!filter_function(document.metadata))) continue; // drop docs if they don't pass the filter
        const tfAdjustmentFactor = options.bm25 ? _getBM25Adjustment(docHash, db) : // handle BM25 or opposite of it here
            options.punish_verysmall_documents ? _getVerySmallDocumentPunishment(docHash, db) : 1;  

        let scoreThisDoc = 0, tfScoreThisDoc = 0, queryWordsFoundInThisDoc = 0, 
            documentsWithWordsCount = await db.iindex.getCountOfDocumentsWithWords(queryWords);
        for (const queryWord of queryWords) {
            if (!await db.iindex.isWordInVocabulary(queryWord)) continue; // query word not found in the vocabulary
            const tf = await db.iindex.getWordCountForDocument(queryWord, docHash)/document.length, tfAdusted = tf*tfAdjustmentFactor,
                totalDocLength = await db.tfidfDocStore.totalDocsInDB(), docsWithThisWord = documentsWithWordsCount[queryWord],
                idf = 1+Math.log10(totalDocLength/(docsWithThisWord+1)), tfidf = tfAdusted*idf;
            tfScoreThisDoc += tfAdusted; scoreThisDoc += tfidf; if (tfAdusted) queryWordsFoundInThisDoc++;
        }

        const max_coord_boost = options.max_coord_boost||DEFAULT_MAX_COORD_BOOST, 
        coordScore = (!options.ignore_coord) ? 1+(max_coord_boost*queryWordsFoundInThisDoc/queryWords.length) : 1;
        scoreThisDoc = scoreThisDoc*coordScore; // add in coord scoring
        scoredDocs.push({metadata: document.metadata, score: scoreThisDoc, coord_score: coordScore, tf_score: tfScoreThisDoc,
            tfidf_score: scoreThisDoc/coordScore, query_tokens_found: queryWordsFoundInThisDoc, total_query_tokens: queryWords.length}); 
        if (scoreThisDoc > highestScore) highestScore = scoreThisDoc;
    }

    let filteredScoredDocs = []; if (filter_function) { for (const scoredDoc of scoredDocs)   // post-filter here if indicated
        if (filter_function(scoredDoc.metadata)) filteredScoredDocs.push(scoredDoc); } else filteredScoredDocs = scoredDocs;

    filteredScoredDocs.sort((doc1, doc2) => doc1.score < doc2.score ? 1 : doc1.score > doc2.score ? -1 : 0);
    // if cutoff_score is provided, then use it. Use highest score to balance the documents found for the cutoff
    let cutoffDocs = []; if (cutoff_score) for (const scoredDocument of filteredScoredDocs) {  
        scoredDocument.cutoff_scaled_score = scoredDocument.score/highestScore; scoredDocument.highest_query_score = highestScore;
        if (scoredDocument.cutoff_scaled_score >= cutoff_score) cutoffDocs.push(scoredDocument);
    } else cutoffDocs = filteredScoredDocs;
    const topKScoredDocs = topK ? cutoffDocs.slice(0, (topK < cutoffDocs.length ? topK : cutoffDocs.length)) : cutoffDocs;
    return topKScoredDocs;
}

function _getLangNormalizedWords(document, lang, db, autocorrect=false, fastSplit=true) {   // autocorrect and auto-stop word detection uses local DB only here  
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
    const _isStopWord = word => {   // can auto learn stop words if needed, language agnostic, uses only local DB
        if (word.trim() == "") return true; // emptry words are useless
        const dbHasStopWords = db._stopwords?.[lang] && db._stopwords[lang].length > 0;
        if (!dbHasStopWords) {   // auto learn stop words if possible
            const dbDocCount = db.tfidfDocStore.totalDocsInDB(true);
            if (dbDocCount > MIN_STOP_WORD_IDENTIFICATION_LENGTH) {
                if (!db._stopwords) db._stopwords = {}; db._stopwords[lang] = [];
                for (const word of db.iindex.getAllLocalWords())
                    if ((db.iindex.getCountOfLocalDocumentsWithWord(word)/dbDocCount) > MIN_PERCENTAGE_COMMON_DOCS_FOR_STOP_WORDS) 
                        db._stopwords[lang].push(word);
            }   
        }
        
        if (!db._stopwords?.[lang]) return false;   // nothing to do
        const isStopWord = db._stopwords[lang].includes(word); 
        return isStopWord;
    }
    // currently autocorrect is only supported for English
    const correctwords = autocorrect && lang=="en", spellcheck = correctwords ? 
        new natural.Spellcheck(db.iindex.getAllLocalWords()) : undefined;
    for (const segmentThis of Array.from(segmenter.segment(document))) if (segmentThis.isWordLike) {
        const depuntuatedLowerLangWord = segmentThis.segment.replaceAll(PUNCTUATIONS, "").trim().toLocaleLowerCase(lang);
        if (_isStopWord(depuntuatedLowerLangWord)) continue;    // drop stop words
        let stemmedWord = _getStemmer(lang).stem(depuntuatedLowerLangWord);
        if (correctwords && (!db.iindex.isWordInLocalVocabulary(stemmedWord))) {
            const correctedWord = spellcheck.getCorrections(stemmedWord, 1)[0];
            if (correctedWord && db.iindex.isWordInLocalVocabulary(correctedWord)) stemmedWord = correctedWord;
        } 
        words.push(stemmedWord);
    }
    LOG.info(`Ending getting normalized words for the document.`);
    return words;
}

function _getVerySmallDocumentPunishment(dochash, db) { // this function doesn't go across the cluster when calculating averages, which may be OK as average should be similar across the cluster.
    const thisDocLength = db.tfidfDocStore.data(dochash).length;
    let totalDocLength = 0; for (const hash of db.tfidfDocStore.localDocumentHashes()) totalDocLength += db.tfidfDocStore.data(hash).length;
    const averageDocLength = totalDocLength/db.tfidfDocStore.localDocumentHashes().length;
    const cappedPercentThidDocLengthToAverageLength = Math.min(thisDocLength/averageDocLength,1);
    const weightedDistanceOfThisDocLengthFromAverage = 1-cappedPercentThidDocLengthToAverageLength, 
        squaredWeightedDistance = weightedDistanceOfThisDocLengthFromAverage**2;
    const punishment = 1-squaredWeightedDistance;  // this function punishes very small documents hard, but decays quickly
    return punishment;
}

function _getBM25Adjustment(dochash, db) {  // this function doesn't go across the cluster when calculating averages, which may be OK as average should be similar across the cluster.
    const thisDocLength = db.tfidfDocStore.data(dochash).length;
    let totalDocLength = 0; for (const hash of db.tfidfDocStore.localDocumentHashes()) totalDocLength += db.tfidfDocStore.data(hash).length;
    const averageDocLength = totalDocLength/db.tfidfDocStore.localDocumentHashes().length;
    const bm25AdjustmentDenominator = thisDocLength/averageDocLength;
    return 1/bm25AdjustmentDenominator;
}

const _getDocumentHashIndex = (metadata, db) => {
    const lang = metadata[db[METADATA_LANGID_KEY]]||"en";
    if (metadata[db[METADATA_DOCID_KEY]]) return metadata[db[METADATA_DOCID_KEY]]; 
    else {  // hash the object otherwise
        const lowerCaseObject = {}; for (const [key, keysValue] of Object.entries(metadata))
            lowerCaseObject[key.toLocaleLowerCase?key.toLocaleLowerCase(lang):key] = 
                keysValue.toLocaleLowerCase?keysValue.toLocaleLowerCase(lang):keysValue;
        return crypto.createHash("md5").update(JSON.stringify(lowerCaseObject)).digest("hex");
    }
}

const _deepclone = object => JSON.parse(JSON.stringify(object));

const _createDBCreationData = db => {
    return { metadata_docid_key: db[METADATA_DOCID_KEY], no_stemming: db.no_stemming, 
        metadata_langid_key: db[METADATA_LANGID_KEY], stopwords_path: db.stopwords_path, pathOrMemID: db.pathOrMemID, 
        mem_only: db.mem_only };
}

function _initBlackboardHooks() {
    const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;

    blackboard.subscribe(TFIDFDB_UPDATE_DOC_TOPIC, async msg => {
        const {creation_data, oldmetadata, newmetadata} = msg;
        const db = (await exports.get_tfidf_db(creation_data.pathOrMemID, creation_data.metadata_docid_key, 
            creation_data.metadata_langid_key, creation_data.stopwords_path, creation_data.no_stemming, 
            creation_data.mem_only))._getRawDB();
        exports.update(oldmetadata, newmetadata, db, false);
    }, bboptions);

    blackboard.subscribe(TFIDFDB_DELETE_DOC_TOPIC, async msg => {
        const {creation_data, metadata} = msg;
        const db = (await exports.get_tfidf_db(creation_data.pathOrMemID, creation_data.metadata_docid_key, 
            creation_data.metadata_langid_key, creation_data.stopwords_path, creation_data.no_stemming, 
            creation_data.mem_only))._getRawDB();
        exports.delete(metadata, db, false);
    }, bboptions);

    blackboard.subscribe(TFIDFDB_INTERNAL_FUNCTION_CALL_TOPIC, async msg => {
        const {creation_data, module_name, function_name, params, blackboardcontrol} = msg;
        const db = (await exports.get_tfidf_db(creation_data.pathOrMemID, creation_data.metadata_docid_key, 
            creation_data.metadata_langid_key, creation_data.stopwords_path, creation_data.no_stemming, 
            creation_data.mem_only))._getRawDB();
        const functionParams = [...(params||[]), true], functionResult = await db[module_name][function_name](...functionParams);
        blackboard.sendReply(TFIDFDB_INTERNAL_FUNCTION_CALL_TOPIC, blackboardcontrol, {reply: functionResult});
    }, bboptions);
}

function _getDistributedResultFromFunction(db, module_name, function_name, params) {
    return new Promise(resolve => blackboard.getReply(TFIDFDB_INTERNAL_FUNCTION_CALL_TOPIC, 
        {creation_data: _createDBCreationData(db), module_name, function_name, params}, 
        conf.cluster_timeout, undefined, replies=>resolve(_unmarshallReplies(replies))));
}

const _unmarshallReplies = replies => {
    const unmarshalled = []; for (const reply of (replies||[])) unmarshalled.push(reply.reply); return unmarshalled;}