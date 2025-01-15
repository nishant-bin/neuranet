/** 
 * A simple vector database/indexer/matcher. Uses flat, in-memory index and 
 * an exhaustive search. Expected to be slow as the index size increases beyond
 * millions of (typically sized) documents on a 8GB VM/container, unless sharding 
 * and multiple index/node combinations are used.  Only supports pure text documents,
 * other document types should be converted to text before indexing.
 * 
 * Uses cosine similarity for queries. Supports pluggable embedding generators
 * to support various AI models for generating embeddings.
 * 
 * Supports CRUD operations on the index, and query to return topK matching vectors.
 * 
 * Not ACID and the serialization to the disk is "best effort, and when possible",
 * but automatic.
 * 
 * But on the plus side - needs nothing else, runs in-process, etc. 
 * 
 * Use exports.get_vectordb factory to get a vector DB for a new or existing index.
 * That ensures the DB is properly initialized on the disk before using it (await for it).
 * 
 * Memory calculations (excluding data portion) - each vector with 1500 dimensions
 * would be 6K as 1500*64bits = 6KB. So an index with 30,000 documents (at typically 
 * 10 vectors per document) would be 30000*10*6/1000 MB = 1800 MB or 1.8GB. 
 * 300,000 such documents would be 18 GB and 500,000 (half a million) documents 
 * would be approximately 30 GB of memory. So for approx 100,000 documents we'd need
 * 6GB of RAM. 
 * 
 * Flat indexing takes about 95 ms on a 2 core, 6 GB RAM box with 5,000 documents to
 * search. May be faster on modern processors or GPUs. 
 * 
 * Can be multithreaded, if selected during initialization. Will use worker threads 
 * for queries if multithreaded. Multithreading is on a per database level, however
 * will use (cores-1)*memory (see memory calculations above) if enabled even for 
 * one sub-database.
 * 
 * The module supports multiple databases, a strategy to shard would be to break logical
 * documents types into independent databases, shard them over multiple machines. This 
 * would significantly reduce per machine memory needed, and significantly boost performance.
 * 
 * TODO: An upcoming new algorithm for fast, 100% accurate exhaustive search would be
 * added by Tekmonks once testing is completed. Making this the easiest, and a really 
 * fast vector database for all types of production loads and AI applications. Algo will be 
 * based on quantized buckets for cosine distance from a reference vector (middle of dimensional
 * cube for the vectors may be a good starting reference vector). Unlike KNN algorithms which are
 * approximate (as they divide the space), such an approach would be 100% accurate but won't be
 * as fast as KNN as the resulting quantized buckets will not be encoding the direction of the
 * distance, so an exhaustive search inside the bucket would still be needed. But the bucket size
 * which depends on the quantization interval can be controlled making this still a good approach.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cpucores = os.cpus().length*2;    // assume 2 cpu-threads per core (hyperthreaded cores)
const maxthreads_for_search = cpucores - 1; // leave 1 thread for the main program
const worker_threads = require("worker_threads");
const memfs = require(`${CONSTANTS.LIBDIR}/memfs.js`);
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/aidb.json`);

const dbs = {}, DB_INDEX_NAME = "dbindex", METADATA_DOCID_KEY="aidbdocidkey", METADATA_DOCID_KEY_DEFAULT="aidb_docid",
    VECTORDB_FUNCTION_CALL_TOPIC = "vectordb.functioncall", workers = [],
    DB_INDEX_OBJECT_TEMPLATE = {index:{}, modifiedts:Date.now(), savedts: 0, multithreaded: false, memused: 0, path: ""};

let dbs_worker, workers_initialized = false, blackboard_initialized = false;

// Add in listeners for multi-threading support
if (!worker_threads.isMainThread) worker_threads.parentPort.on("message", async message => {    
    let result;
    if (message.function == "setDatabase") result = _worker_setDatabase(...message.arguments);
    if (message.function == "calculate_cosine_similarity") result = _worker_calculate_cosine_similarity(...message.arguments);
    worker_threads.parentPort.postMessage({id: message.id, result});
});

/**
 * Inits the vector DB whose path is given.
 * @param {string} db_path_in The DB path
 * @param {string} metadata_docid_key The document ID key inside metadata
 * @param {boolean} multithreaded Run multi threaded or single threaded (only really ever useful for queries)
 * @throws Exception on errors 
 */
exports.initAsync = async (db_path_in, metadata_docid_key, multithreaded) => {
    if (!blackboard_initialized) {_initBlackboardHooks(); blackboard_initialized = true;}

    if (multithreaded && (!workers_initialized)) {  // create worker threads if we are multithreaded
        workers_initialized = true;
        const workersOnlinePromises = [];
        for (let i = 0; i < maxthreads_for_search; i++) workersOnlinePromises.push(new Promise(resolve => { //create workers
            const worker = new worker_threads.Worker(__filename);
            workers.push(worker); worker.on("online", resolve);
        }));
        await Promise.all(workersOnlinePromises);  // make sure all are online
    }

    try {await memfs.access(db_path_in, fs.constants.R_OK)} catch (err) {
        _log_error("Vector DB path folder does not exist. Initializing to an empty DB", db_path_in, err); 
        await memfs.mkdir(db_path_in, {recursive:true});
        dbs[_get_db_index(db_path_in)] = _createEmptyDB(db_path_in, multithreaded); // init to an empty db
        dbs[_get_db_index(db_path_in)][METADATA_DOCID_KEY] = metadata_docid_key;
        return;
    }

    try {if (!dbs[_get_db_index(db_path_in)]) await exports.read_db(db_path_in, metadata_docid_key, multithreaded);} catch (err) { // read if not in memory already
        _log_error("Vector DB index does not exist, or read error. Initializing to an empty DB", db_path_in, err); 
        dbs[_get_db_index(db_path_in)] = _createEmptyDB(db_path_in, multithreaded); // init to an empty db
        dbs[_get_db_index(db_path_in)][METADATA_DOCID_KEY] = metadata_docid_key;
    }
}

/**
 * Reads the DB from the disk to the memory
 * @param {string} db_path_in The DB path
 * @param {string} metadata_docid_key The document ID key inside metadata
 * @param {boolean} multithreaded Run multi threaded or single threaded (only really ever useful for queries)
 * @throws Exception on errors 
 */
exports.read_db = async (db_path_in, metadata_docid_key, multithreaded) => {
    dbToFill = _createEmptyDB(db_path_in, multithreaded);
    dbToFill[METADATA_DOCID_KEY] = metadata_docid_key;
    dbs[_get_db_index(db_path_in)] = dbToFill;

    const indexFilesForDB = await _get_db_index_files(db_path_in); for (const indexFile of indexFilesForDB) {
        const ndjson_index = await memfs.readFile(indexFile, "utf8");
        for (const vector of ndjson_index.split("\n")) { 
            if (vector.trim() == "") continue;  // ignore blank lines
            const vectorObject = JSON.parse(vector); 
            await _setDBVectorObject(dbToFill, vectorObject);
        }
        await _update_db_for_worker_threads();
    }
}

/**
 * Saves the DB to the file system.
 * @param {string} db_path_out DB path out
 * @param {boolean} force Forces the save even if DB is not dirty
 */
exports.save_db = async (db_path_out, force) => {
    const db_to_save = dbs[_get_db_index(db_path_out)]; if (!db_to_save) {
        _log_error("Nothing to save in save_db call", db_path_out, "No database found");
        return;
    }

    if ((db_to_save.modifiedts < db_to_save.savedts) && (!force)) return;  // no need

    try {
        const memFSPromises = [];
        for (const indexHash of Object.keys(db_to_save.index)) {
            const vectorObject = _getDBVectorObject(db_to_save, indexHash);
            const ndjsonLine = JSON.stringify(vectorObject) + "\n";
            const indexFile = await _getIndexFileForVector(db_to_save, indexHash, true);
            memFSPromises.push(memfs.appendFile(indexFile, ndjsonLine));
        }
        await Promise.all(memFSPromises); await memfs.flush();
        db_to_save.savedts = Date.now();    
    } catch (err) {_log_error("Error saving the database index in save_db call", db_path_out, err);}
}

/**
 * Creates and adds a new vector to the DB.
 * @param {array} vector The vector to add, if null, then embedding generator will be used to create a new vector
 * @param {object} metadata The metadata object for the vector
 * @param {string} text The associated text for the vector
 * @param {function} embedding_generator The embedding generator of format `vector = await embedding_generator(text)`
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @throws Exception on errors 
 */
exports.create = exports.add = async (vector, metadata, text, embedding_generator, db_path) => {
    if ((!vector) && embedding_generator && text) try {vector = await embedding_generator(text);} catch (err) {
        _log_error("Vector embedding generation failed", db_path, err); 
        return false;
    }
    if (!vector) {  // nothing to do
        _log_error("No vector found or generated for Vector DB update, skipping create/add operation", db_path, "Either the embedding generator failed or no text was provided to embed"); 
        return false;
    }

    const dbToUse = dbs[_get_db_index(db_path)]; if (!dbToUse) {
        _log_error("No vector databse found at the path given.", db_path, "No database found"); 
        return false;
    }
    if (!metadata[dbToUse[METADATA_DOCID_KEY]]) throw new Error("Missing document ID in metadata.");

    const vectorHash = _get_vector_hash(vector, metadata, dbToUse); 
    if (!_getDBVectorObject(dbToUse, vectorHash)) {  
        await _setDBVectorObject(dbToUse, {vector, hash: vectorHash, metadata, length: _getVectorLength(vector)}, true);
        
        try {await memfs.writeFile(_get_db_index_text_file(dbToUse, vectorHash), text||"", "utf8");}
        catch (err) {
            _deleteDBVectorObject(db_path, vectorHash);
            _log_error(`Vector DB text file ${_get_db_index_text_file(dbToUse, vectorHash)} could not be saved`, db_path, err);
            return false;
        }
        if (dbToUse.multithreaded) await _update_db_for_worker_threads();
    } 
    
    _log_info(`Added vector ${vector} with hash ${vectorHash} to DB.`, db_path, true);
    return vector;
}

/**
 * Reads the given vector from the database and returns its object.
 * @param {array} vector The vector to read
 * @param {object} metadata The associated metadata
 * @param {boolean} notext Do not return associated text
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @returns Vector object of the format `{vector:[...], metadata:{...}}`
 * @throws Exception on errors 
 */
exports.read = async (vector, metadata, notext, db_path) => {
    const dbToUse = dbs[_get_db_index(db_path)], hash = _get_vector_hash(vector, metadata, dbToUse);
    const vectorObject = _getDBVectorObject(dbToUse, hash);
    if (!vectorObject) return null;    // not found

    let text; 
    if (!notext) try {  // read the associated text unless told not to, don't cache these files
        text = await memfs.readFile(_get_db_index_text_file(dbToUse, hash), {encoding: "utf8", memfs_dontcache: true});
    } catch (err) { 
        _log_error(`Vector DB text file ${_get_db_index_text_file(dbToUse, hash)} not found or error reading`, db_path, err); 
        return null;
    }
    
    return {...vectorObject, text};  
}

/**
 * Updates the vector DB's vector with the new information provided.
 * @param {array} vector The vector to update
 * @param {object} oldmetadata The old metadata
 * @param {object} newmetadata The new metadata
 * @param {string} text The associated text
 * @param {function} embedding_generator The embedding generator, see create for format
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @throws Exception on errors 
 */
exports.update = async (vector, oldmetadata, newmetadata, text, embedding_generator, db_path) => {
    if (!vector) {_log_error("Update called without a proper index vector", db_path, "Vector to update not provided"); return false;}
    
    await exports.delete(vector, oldmetadata, db_path);  // delete or try to delete first - this will remove it from which ever vector DB has it (including distributed)
    return await exports.create(vector, newmetadata, text, embedding_generator, db_path);  // add it back
}

/**
 * Deletes the given vector from the DB.
 * @param {array} vector The vector to update
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @throws Exception on errors 
 */
exports.delete = async (vector, metadata, db_path) => {
    const dbToUse = dbs[_get_db_index(db_path)], hash = _get_vector_hash(vector, metadata, dbToUse); 

    try {
        const deletedVectorFromThisDB = await _deleteDBVectorObject(db_path, hash); // will return true if was found and delete on the local DB
        if (dbToUse.multithreaded && deletedVectorFromThisDB) await _update_db_for_worker_threads();
        return true;
    } catch (err) {
        _log_error(`Vector or the associated text file ${_get_db_index_text_file(dbToUse, hash)} could not be deleted`, db_path, err);
        return false;
    }
}

/**
 * Queries the vector database and returns the results.
 * @param {array} vectorToFindSimilarTo The vector of floats to search similar to, if not provided, searches all objects
 * @param {number} topK The topK results to return, set to a negative number to return all results
 * @param {float} min_distance The minimum similarity distance - can be a float between 0 to 1
 * @param {function} metadata_filter_function The metadata filter function
 * @param {boolean} notext If document text is not needed, set it to true
 * @param {string} db_path The database path
 * @param {boolean} filter_metadata_last If set to true, then similarity search is performed first, then metadata filtering. Default is false.
 * @param {number} benchmarkIterations If DB is in benchmarking mode, set the number of iterations to benchmark the search
 * @returns An array of {vector, similarity, metadata, text} objects matching the results.
 */
exports.query = async function(vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, db_path, 
        filter_metadata_last, benchmarkIterations, _forceSingleNode) {
    const dbToUse = serverutils.clone(dbs[_get_db_index(db_path)]); _log_info(`Searching ${Object.values(dbToUse.index).length} vectors.`, db_path);
    const _searchSimilarities = async _ => {
        const similaritiesOtherReplicas = dbToUse.distributed && (!_forceSingleNode) ? 
            await _getDistributedSimilarities([vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, 
                notext, db_path, filter_metadata_last, benchmarkIterations]) : [];
        const similaritiesThisReplica = dbToUse.multithreaded ? await _search_multithreaded(
                db_path, vectorToFindSimilarTo, (!filter_metadata_last)?metadata_filter_function:undefined) :
            _search_singlethreaded(dbToUse, vectorToFindSimilarTo, 
                (!filter_metadata_last)?metadata_filter_function:undefined);
        const similaritiesFinal = [...similaritiesOtherReplicas, ...similaritiesThisReplica];
        return similaritiesFinal;
    }

    let similarities; if (benchmarkIterations) {
        _log_error(`Vector DB is in benchmarking mode. Performance will be affected. Iterations = ${benchmarkIterations}. DB index size = ${Object.values(dbToUse.index).length} vectors. Total simulated index size to be searched = ${parseInt(process.env.__ORG_MONKSHU_VECTORDB_BENCHMARK_ITERATIONS)*Object.values(dbToUse.index).length} vectors.`, db_path);
        for (let i = 0; i < benchmarkIterations; i++) similarities = await _searchSimilarities();
    } else similarities = await _searchSimilarities();
        
    if (vectorToFindSimilarTo) similarities.sort((a,b) => b.similarity - a.similarity);
    const results = []; for (const similarity_object of similarities) { // maybe we can multithread this as well as it is all CPU
        if (results.length == topK) break;  // done filtering
        if (vectorToFindSimilarTo && min_distance && (similarity_object.similarity < min_distance)) break; // filter for minimum distance if asked
        // filter the results further by conditioning on the metadata, if a filter was provided
        if (filter_metadata_last && metadata_filter_function && (!metadata_filter_function(similarity_object.metadata))) continue;
        results.push(similarity_object);
    }
    similarities = []; // try to free memory asap

    if (!notext) for (const similarity_object of results) {
        if(similarity_object.text) continue; // already has the text,no need to get the text
        const hash = _get_vector_hash(similarity_object.vector, similarity_object.metadata, dbToUse), 
            textFile = _get_db_index_text_file(dbToUse, hash);
        try { // read associated text, unless told not to
            similarity_object.text = await memfs.readFile(textFile, "utf8");
        } catch (err) { 
            _log_error(`Vector DB text file ${textFile} not found or error reading`, db_path, err); return false; }
    }

    return results; 
}

/**
 * Ingests the given document into the vector database. It will split the document and return
 * the generated vectors for each chunk.
 * @param {object} metadata The associated metadata
 * @param {string} document Text to ingest
 * @param {number} chunk_size The chunk size - must be less than what is the maximum for the embedding_generator
 * @param {array} split_separators The characters on which we can split
 * @param {number} overlap The overlap characters for each split. Not sure this is useful, usually 0 should be ok.
 * @param {function} embedding_generator The embedding generator, see create for format
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @param {boolean} return_tail_do_not_ingest If set, and there is some remaining tail chunk less than chink_size 
 *                                            then it will not ingest that tail, but return it instead as uningested text.
 * @returns An object of the format `{vectors_ingested: [], tail_chunk: tailChunkRemains ? "text" : undefined}`
 */
exports.ingest = async function(metadata, document, chunk_size, split_separators, overlap, embedding_generator, 
        db_path, return_tail_do_not_ingest) {

    const _find_split_separator = (split_start, raw_split_point) => {
        const rawChunk = document.substring(split_start, raw_split_point);
        let split_separator_to_use; for (const split_separator of Array.isArray(split_separators) ? split_separators : [split_separators])
            if ((rawChunk.indexOf(split_separator) != -1) && (rawChunk.lastIndexOf(split_separator) != 0)) {
                split_separator_to_use = split_separator; break }
        if (!split_separator_to_use) return raw_split_point;    // seperator not found -- so go with it all as is
        const split_point = split_start+rawChunk.lastIndexOf(split_separator_to_use);
        return split_point;
    }

    let split_start = 0, split_end = (split_start+chunk_size) < document.length ? 
        _find_split_separator(split_start, split_start+chunk_size) : document.length;

    const vectorsToReturn = []; let tailChunkRemains = false;
    while (split_end <= document.length && (split_start != split_end)) {
        const split = document.substring(split_start, split_end).trim(), skipSegement = (split == ""); 
        
        if (!skipSegement) {    // blank space has no meaning
            const createdVector = await exports.create(undefined, metadata, split, embedding_generator, db_path);
            if (!createdVector) {
                _log_error("Unable to inject, creation failed", db_path, "Adding the new chunk failed");
                await _deleteAllCreatedVectors(vectorsToReturn, metadata, db_path);
                return false;
            } else vectorsToReturn.push(createdVector);
        }

        if (split_end-overlap+chunk_size > document.length && return_tail_do_not_ingest) {tailChunkRemains = true; break;}
        split_start = split_end - overlap; split_end = (split_start+chunk_size) < document.length ? 
            _find_split_separator(split_start, split_start+chunk_size) : document.length;
    }

    return {vectors_ingested: vectorsToReturn, tail_chunk: tailChunkRemains ? document.substring(split_end) : undefined}
}

/**
 * Deletes the given vectors from the DB.
 * @param {array} vectors Array of vectors to delete
 * @param {object} metadata The metadata for all these vectors
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 */
exports.uningest = async (vectors, metadata, db_path) => { for (const vector of vectors) await exports.delete(vector, metadata, db_path); }

/**
 * Ingests a stream into the database. Memory efficient and should be the function of choice to use
 * for ingesting large documents into the database.
 * @param {object} metadata The associated metadata
 * @param {object} stream The incoming text data stream (must be text)
 * @param {string} encoding The encoding for the text stream, usually UTF8
 * @param {number} chunk_size The chunk size - must be less than what is the maximum for the embedding_generator
 * @param {array} split_separators The characters on which we can split
 * @param {number} overlap The overlap characters for each split. Not sure this is useful, usually 0 should be ok.
 * @param {function} embedding_generator The embedding generator, see create for format
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @returns {array} An array of vectors ingested
 * @throws Errors if things go wrong.
 */
exports.ingeststream = async function(metadata, stream, encoding="utf8", chunk_size, split_separators, overlap, embedding_generator, 
        db_path) {
    
    return new Promise((resolve, reject) => {
        let chunk_to_add = "", stream_ended = false, ingestion_error = false; 

        const vectors_ingested = [], _chunkIngestionFunction = async (chunk, ingestLeftOver) => {
            if (ingestion_error) return;    // something failed previously in this stream, stop ingestion
            if (chunk) chunk_to_add += chunk.toString(encoding).replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ");   // remove extra whitespaces. #1 they destroy the semantics, #2 at least openai can choke on them for embeddings
            if ((chunk && (chunk_to_add.length >= chunk_size)) || (ingestLeftOver && chunk_to_add.length)) {
                const ingestionResult = await exports.ingest(metadata, chunk_to_add, chunk_size, split_separators, 
                    overlap, embedding_generator, db_path, true);
                if ((!ingestionResult) || (!ingestionResult.vectors_ingested)) {
                    LOG.error(`Ingestion error in chunk. Related metadata was ${JSON.stringify(metadata)}`)
                    ingestion_error = true; _deleteAllCreatedVectors(vectors_ingested, metadata, db_path); 
                    stream.destroy("VectorDB ingestion failed."); return; }
                chunk_to_add = ingestionResult.tail_chunk||""; // whatever was left - start there next time
                vectors_ingested.push(...ingestionResult.vectors_ingested);
            }
        }

        const chunkIngestionsWaitingPromises = [];
        const executionQueue = [], _executionQueueFunction = async chunk => {
            chunkIngestionsWaitingPromises.push(_chunkIngestionFunction(chunk)); executionQueue.pop(); // remove this function from the queue
            if (executionQueue.length) (executionQueue[executionQueue.length-1])(); // process the next function
            else _processStreamEnding();
        };

        let _endingProcessed = false; const _processStreamEnding = async _ => {
            if (stream_ended && (executionQueue.length == 0) && (!_endingProcessed)) {
                await Promise.all(chunkIngestionsWaitingPromises);  // wait for all ingestions to end
                _endingProcessed = true; if (!ingestion_error) await _chunkIngestionFunction(null, true); // tail ingested
                if (!ingestion_error) resolve(vectors_ingested); else reject("Ingestion error in chunk ingestion stream."); 
            } 
        }

        stream.on("data", async chunk => {
            executionQueue.unshift(async _=> await _executionQueueFunction(chunk));
            if (executionQueue.length == 1) (executionQueue[executionQueue.length-1])(); // start the queue if not running
        });

        stream.on("error", err => {
            if (err) LOG.error(`Read stream didn't close properly, ingestion failed. Related metadata was ${JSON.stringify(metadata)}.`);
            reject(err);
        });

        stream.on("end", _=>{stream_ended = true; _processStreamEnding();});
    });
} 

/**
 * Unloads the DB and frees the memory.
 * @param {string} db_path The path to the DB. Must be a folder.
 */
exports.free = async db_path => {await flush_db(path); delete dbs[_get_db_index(db_path)];}   // free memory and unload

/**
 * Returns the vector database on the path provided. This is the function of choice to use for all 
 * vector database operations.
 * @param {string} db_path The path to the database. Must be a folder.
 * @param {function} embedding_generator The embedding generator of format `vector = await embedding_generator(text)`
 * @param {string} metadata_docid_key The metadata docid key, is needed and if not provided then assumed to be aidb_docid
 * @param {boolean} isMultithreaded Whether to run the database in multi-threaded mode
 * @returns {object} The vector database object with various CRUD operations.
 */
exports.get_vectordb = async function(db_path, embedding_generator, metadata_docid_key=METADATA_DOCID_KEY_DEFAULT, isMultithreaded) {
    await exports.initAsync(db_path, metadata_docid_key, isMultithreaded); 
    let save_timer; if (conf.autosave) save_timer = setInterval(_=>exports.save_db(db_path), conf.autosave_frequency);
    return {
        create: async (vector, metadata, text) => exports.create(vector, metadata, text, embedding_generator, db_path),
        ingest: async (metadata, document, chunk_size, split_separators, overlap) => exports.ingest(metadata, document, 
            chunk_size, split_separators, overlap, embedding_generator, db_path),
        ingeststream: async(metadata, stream, encoding="utf8", chunk_size, split_separators, overlap) => 
            exports.ingeststream(metadata, stream, encoding, chunk_size, split_separators, overlap, 
                embedding_generator, db_path),
        read: async (vector, metadata, notext) => exports.read(vector, metadata, notext, db_path),
        update: async (vector, oldmetadata, newmetadata, text) => exports.update(vector, oldmetadata, newmetadata, text, embedding_generator, db_path),
        delete: async (vector, metadata) =>  exports.delete(vector, metadata, db_path),    
        uningest: async (vectors, metadata) => exports.uningest(vectors, metadata, db_path),
        query: async (vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, filter_metadata_last, 
                benchmarkIterations) => exports.query(
            vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, db_path, filter_metadata_last, 
            benchmarkIterations),
        flush_db: async _ => exports.save_db(db_path, true),
        get_path: _ => db_path, 
        get_embedding_generator: _ => embedding_generator,
	    sort: vectorResults => vectorResults.sort((a,b) => b.similarity - a.similarity),
        unload: async _ => {if (save_timer) clearInterval(save_timer); await exports.free(db_path);}
    }
}

/** Internal functions start, not exported. */

// Start: Cosine similarity calculator: Shared function for single threaded search and workers, btw this 
// affects the search performance the most so the code here MUST be fastest, most optimized version we can 
// come up with. Precalculating vector lengths is one such optimization, so that we don't need to calculate 
// any lengths during searching, which saves a lot of CPU time and cycles.
const _cosine_similarity = (v1, v2, lengthV1, lengthV2) => {    
    if (v1.length != v2.length) throw Error(`Can't calculate cosine similarity of vectors with unequal dimensions, v1 dimensions are ${v1.length} and v2 dimensions are ${v2.length}.`);
    let vector_product = 0; for (let i = 0; i < v1.length; i++) vector_product += v1[i]*v2[i];
    if (!lengthV1) lengthV1 = _getVectorLength(v1); if (!lengthV2) lengthV2 = _getVectorLength(v2);
    const cosine_similarity = vector_product/(lengthV1*lengthV2);
    return cosine_similarity;
}
// End: Cosine similarity calculator

function _search_singlethreaded(dbToUse, vectorToFindSimilarTo, metadata_filter_function) {
    const similarities = [], lengthOfVectorToFindSimilarTo = vectorToFindSimilarTo?
        _getVectorLength(vectorToFindSimilarTo):undefined;
    for (const indexHash of Object.keys(dbToUse.index)) {
        const entryToCompareTo = _getDBVectorObject(dbToUse, indexHash);
        if ((!metadata_filter_function) || metadata_filter_function(entryToCompareTo.metadata)) similarities.push({   // calculate cosine similarities
            vector: entryToCompareTo.vector, 
            similarity: vectorToFindSimilarTo ? _cosine_similarity(entryToCompareTo.vector, vectorToFindSimilarTo, 
                entryToCompareTo.length, lengthOfVectorToFindSimilarTo) : undefined,
            metadata: entryToCompareTo.metadata});
    }
    return similarities;
}

async function _search_multithreaded(dbPath, vectorToFindSimilarTo, metadata_filter_function) {
    const lengthOfVectorToFindSimilarTo = vectorToFindSimilarTo?_getVectorLength(vectorToFindSimilarTo):undefined;
    const entries = Object.values(dbs[_get_db_index(dbPath)].index), splitLength = entries.length/maxthreads_for_search; 
    
    const _getSimilaritiesFromWorker = async (worker, start, end) => await _callWorker(worker,
        "calculate_cosine_similarity", [dbPath, start, end, vectorToFindSimilarTo, lengthOfVectorToFindSimilarTo, metadata_filter_function]);
    const _getSimilarityPushPromise = async (similarities, worker, start, end) => 
        similarities.push(...(await _getSimilaritiesFromWorker(worker, start, end)));
    const similarities = [], searchPromises = []; 
    for (let split_num = 0;  split_num < maxthreads_for_search; split_num++) {
        const start = split_num*splitLength, end = ((split_num*splitLength)+splitLength > entries.length) ||
            (split_num ==  maxthreads_for_search - 1) ? entries.length : (split_num*splitLength)+splitLength;
        try { searchPromises.push(_getSimilarityPushPromise(similarities, worker, start, end)); } catch (err) {
            _log_error(`Error during similarity search in worker pools, the error is ${err}. Aborting.`, dbPath);
            return false;
        }
    }

    await Promise.all(searchPromises);  // wait for all search promises to finish, i.e. all worker threads to finish
    return similarities;
}

async function _callWorker(worker, functionToCall, argumentsToSend) {
    return new Promise(resolve => {
        const id = Date.now();
        worker.postMessage({id, function: functionToCall, arguments: argumentsToSend});
        worker.on("message", message => {if (message.id == id) resolve(message.result)});
    });
}

/*** Start: worker module functions ***/
function _worker_calculate_cosine_similarity(dbPath, startIndex, endIndex, vectorToFindSimilarTo, lengthOfVectorToFindSimilarTo, metadata_filter_function) {
    const db = dbs_worker[_get_db_index(dbPath)], indexHashesToCompareTo = Object.keys(db.index).slice(startIndex, endIndex);
    const similarities = []; for (const indexHash of indexHashesToCompareTo) {
        const entryToCompareTo = _getDBVectorObject(db, indexHash);
        if ((!metadata_filter_function) || metadata_filter_function(entryToCompareTo.metadata)) similarities.push({   // calculate cosine similarities
            vector: entryToCompareTo.vector, 
            similarity: vectorToFindSimilarTo ? _cosine_similarity(entryToCompareTo.vector, vectorToFindSimilarTo, 
                entryToCompareTo.length, lengthOfVectorToFindSimilarTo) : undefined,
            metadata: entryToCompareTo.metadata});
    }
    return similarities;
}

function _worker_setDatabase(dbsIn) {
    dbs_worker = dbsIn;
    (global.LOG||console).info(`DB set called on vector DB worker.`); return {result: true};
}
/*** End: worker module functions ***/

const _createEmptyDB = (dbPath, multithreaded) => { return {...(serverutils.clone(DB_INDEX_OBJECT_TEMPLATE)), multithreaded, path: dbPath, distributed: conf.distributed} };

const _update_db_for_worker_threads = async _ => {for (const worker of workers) await _callWorker(worker, "setDatabase", 
    [dbs])}; // send DB to all workers

const _getVectorLength = v => Math.sqrt(v.reduce((accumulator, val) => accumulator + (val*val) ));

const _get_db_index = db_path => path.resolve(db_path);

const _get_db_index_files = async db_path => {
    const indexfiles = [];
    for (const candidateFile of await memfs.readdir(db_path))
        if (candidateFile.startsWith(DB_INDEX_NAME)) indexfiles.push(path.resolve(`${db_path}/${candidateFile}`));
    return indexfiles;
}

const _get_db_index_text_file = (db, hash) => 
    path.resolve(`${db.path}/text_${hash}`);

const _deleteAllCreatedVectors = async (vectors, metadata, db_path) => {for (const vector of vectors) await exports.delete(vector, metadata, db_path);}

function _get_vector_hash(vector, metadata, db) {
    const hashAlgo = crypto.createHash("md5"); hashAlgo.update(vector.toString()+metadata[db[METADATA_DOCID_KEY]||"__undefined_doc__"]);
    const hash = hashAlgo.digest("hex"); return hash;
}

async function _getIndexFileForVector(db, hash, forWriting) {
    const indexFile = `${db.path}/${DB_INDEX_NAME}_${hash}`;
    if (forWriting) await memfs.unlinkIfExists(indexFile)
    return indexFile;
}

async function _setDBVectorObject(dbToFill, vectorObject, isBeingCreated=false) {

    const indexFileThisVector = await _getIndexFileForVector(dbToFill, vectorObject.hash, isBeingCreated);
    if (isBeingCreated) {
        if (isBeingCreated) await memfs.appendFile(indexFileThisVector, JSON.stringify(vectorObject)+"\n", "utf8");
        dbToFill.modifiedts = Date.now();
    }

    dbToFill.index[vectorObject.hash] = vectorObject; dbToFill.memused += serverutils.objectMemSize(vectorObject);

    _log_info(`Data added, now the memory used for vector database is ${dbToFill.memused} bytes.`, dbToFill.path);
}

async function _deleteDBVectorObject(db_path, hash, publish=true) {
    const dbToUse = dbs[_get_db_index(db_path)];
    if (!dbToUse.index[hash]) { 
        if (publish) {  // we do not have this vector, maybe someone else does, just broadcast it
            const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;
            const msg = {dbinitparams: _createDBInitParams(dbToUse), function_params: [db_path, hash, false], 
                function_name: "_deleteDBVectorObject", is_function_private: true, send_reply: false};
            blackboard.publish(VECTORDB_FUNCTION_CALL_TOPIC, msg, bboptions); 
            return false;   // not found locally
        } else return true; // we already don't have this, so deletion is "sort of" successful
    } 

    delete dbToUse.index[hash];
    dbToUse.modifiedts = Date.now();
    const indexFileThisVector = await _getIndexFileForVector(dbToUse, hash, true);
    const textFileThisVector = _get_db_index_text_file(dbToUse, hash);

    await memfs.unlinkIfExists(indexFileThisVector); await memfs.unlinkIfExists(textFileThisVector);
    return true;    // found locally
}

const _getDBVectorObject = (dbToUse, hash) => dbToUse.index[hash];  

function _initBlackboardHooks() {
    const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;

    blackboard.subscribe(VECTORDB_FUNCTION_CALL_TOPIC, async msg => {
        const {dbinitparams, function_name, function_params, is_function_private, send_reply, blackboardcontrol} = msg;
        if (!dbinitparams.dbpath) {LOG.error(`Missing DB path for message ${JSON.stringify(msg)}`); return;}
        if (!dbs[_get_db_index(dbinitparams.dbpath)]) {
            _log_warning(`Unable to locate database ${dbinitparams.dbpath} for distributed function call for ${function_name}. Trying to initialize.`, dbinitparams.dbpath);
            await exports.initAsync(dbinitparams.dbpath, dbinitparams.metadata_docid_key, dbinitparams.multithreaded);
            if (!dbs[_get_db_index(dbinitparams.dbpath)]) {
                _log_error(`Unable to call function ${function_name} as database not found and init failed.`, dbinitparams.dbpath);
                return; // we can't run the function, as we don't have this DB, so this message is not for us
            }
        }
        const functionToCall = is_function_private ? private_functions[function_name] : module.exports[function_name];
        let function_result;
        if (send_reply) function_result = await functionToCall(...function_params); else await functionToCall(...function_params);
        if (send_reply) blackboard.sendReply(VECTORDB_FUNCTION_CALL_TOPIC, blackboardcontrol, {reply: function_result});
    }, bboptions);
}

async function _getDistributedSimilarities(query_params) {
    const [_vectorToFindSimilarTo, _topK, _min_distance, _metadata_filter_function, _notext, db_path, 
        _filter_metadata_last, _benchmarkIterations] = query_params;
    const dbToUse = dbs[_get_db_index(db_path)]; 

    const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;
    const msg = { dbinitparams: _createDBInitParams(dbToUse), function_params: [...query_params, true], 
        function_name: "query", is_function_private: false, send_reply: true };
    const replies = await _getDistributedResultFromFunction(msg);
    if (replies.incomplete) _log_warning(`Received incomplete replies for the query. Results not perfect.`, dbToUse.path);
    const similaritiesOtherReplicas = _unmarshallOtherSimilarityReplies(replies);
    return similaritiesOtherReplicas;
}

function _getDistributedResultFromFunction(msg, bboptions) {
    return new Promise(resolve => blackboard.getReply(VECTORDB_FUNCTION_CALL_TOPIC, 
        msg, conf.cluster_timeout, bboptions, replies=>resolve(replies)));
}

const _unmarshallOtherSimilarityReplies = replies => {
    let unmarshalledSimilarities = []; 
    for (const reply of (replies||[])) unmarshalledSimilarities.push(...(reply.reply)); 
    return unmarshalledSimilarities;
}

const _createDBInitParams = dbToUse => {return {dbpath: dbToUse.path, metadata_docid_key: dbToUse[METADATA_DOCID_KEY], 
    multithreaded: dbToUse.multithreaded}};
const _log_warning = (message, db_path) => (global.LOG||console).warn(
    `${message}. The vector DB is ${_get_db_index(db_path)}.`);
const _log_error = (message, db_path, error) => (global.LOG||console).error(
    `${message}. The vector DB is ${_get_db_index(db_path)}. The error was ${error||"no information"}.`);
const _log_info= (message, db_path, isDebug) => (global.LOG||console)[isDebug?"debug":"info"](
    `${message}. The vector DB is ${_get_db_index(db_path)}.`);

const private_functions = {_deleteDBVectorObject};  // private functions which can be called via distributed function calls
