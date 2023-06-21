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
 * Not ACID - serialization to the disk is "best effort, and when possible",
 * but automatic.
 * 
 * But on the plus side - needs nothing else, runs in-process, etc. Exactly what is 
 * needed for MOST applications, unless you are building the next Google (even then
 * it may still work, with clustering and sharding) :) ;)
 * 
 * Use exports.get_vectordb factory to get a vector DB for a new or existing index.
 * That ensures the DB is properly initialized on the disk before using it (await for it).
 * 
 * Memory calculations (excluding data portion) - each vector with 1500 dimensions
 * would be 6K as 1500*64bits = 6KB. So an index with 30,000 documents (at typically 
 * 3 vectors per document) would be 30000*3*6/1000 MB = 180 MB. 
 * 300,000 such documents would be 1.8 GB and 500,000 (half a million) documents 
 * would be approximately 3 GB of memory. So a 8 GB VM with 2 GB for OS etc should be
 * sufficient for a million typical documents - spread across how many ever indexes 
 * as needed.
 * 
 * Flat indexing takes about 95 ms on a 2 core, 6 GB RAM box with 5,000 documents to
 * search. May be faster on modern processors or GPUs. 
 * 
 * Can be multithreaded, if selected during initialization. Will use worker threads 
 * for queries if multithreaded. Multithreading is on a per database level, however
 * will use (cores-1)*memory (see memory calculations above) if enabled even for 
 * one sub-database.
 * 
 * TODO: An upcoming new algorithm for fast, 100% accurate exhaustive search would be
 * added by Tekmonks once testing is completed. Making this the easiest, and a really 
 * fast vector database for all types of production loads and AI applications.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */
const os = require("os");
const fs = require("fs");
const path = require("path");
const fspromises = fs.promises;
const crypto = require("crypto");
const cpucores = os.cpus().length*2;    // assume 2 cpu-threads per core (hyperthreaded cores)
const maxthreads_for_search = cpucores - 1; // leave 1 thread for the main program
const worker_threads = require("worker_threads");

const dbs = {}, DB_INDEX_NAME = "dbindex.json", DB_INDEX_OBJECT_TEMPLATE = {index:{}, dirty: false},
    workers = [];

let dbs_worker, workers_initialized = false;

if (!worker_threads.isMainThread) worker_threads.parentPort.on("message", async message => {    // multi-threading support
    let result;
    if (message.function == "setDatabase") result = _worker_setDatabase(...message.arguments);
    if (message.function == "calculate_cosine_similarity") result = _worker_calculate_cosine_similarity(...message.arguments);
    worker_threads.parentPort.postMessage({id: message.id, result});
});

exports.initAsync = async (db_path_in, multithreaded) => {
    dbs[_get_db_index(db_path_in)] = {...DB_INDEX_OBJECT_TEMPLATE, multithreaded}; // init to an empty db
    
    if (multithreaded && (!workers_initialized)) {  // create worker threads if we are multithreaded
        workers_initialized = true;
        const workersOnlinePromises = [];
        for (let i = 0; i < maxthreads_for_search; i++) workersOnlinePromises.push(new Promise(resolve => { //create workers
            const worker = new worker_threads.Worker(__filename);
            workers.push(worker); worker.on("online", resolve);
        }));
        await Promise.all(workersOnlinePromises);  // make sure all are online
    }

    try {await fspromises.access(db_path_in, fs.constants.R_OK)} catch (err) {
        _log_error("Vector DB path folder does not exist. Initializing to an empty DB", db_path_in, err); 
        await fspromises.mkdir(db_path_in, {recursive:true});
        return;
    }

    try {
        const db = JSON.parse(await fspromises.readFile(_get_db_index_file(db_path_in), "utf8"));
        dbs[_get_db_index(db_path_in)] = db;
        await _update_db_for_worker_threads();
    } catch (err) {
        _log_error("Vector DB index does not exist, or read error. Initializing to an empty DB", db_path_in, err); 
    }
}

exports.save_db = async db_path_out => {
    const db_to_save = dbs[_get_db_index(db_path_out)]; if (!db_to_save) {
        _log_error("Nothing to save in save_db call", db_path_out, "No database found");
        return;
    }

    if (!db_to_save.dirty) return;  // no need

    try {
        db_to_save.dirty = false;    
        await fspromises.writeFile(_get_db_index_file(db_path_out), JSON.stringify(db_to_save));
    } catch (err) {
        db_to_save.dirty = true;    // save failed
        _log_error("Error saving the database index in save_db call", db_path_out, err);
    }
}

exports.create = exports.add = async (vector, metadata, text, embedding_generator, db_path) => {
    if ((!vector) && embedding_generator && text) try {vector = await embedding_generator(text);} catch (err) {
        _log_error("Vector embedding generation failed", db_path, err); 
        return false;
    }
    if (!vector) {  // nothing to do
        _log_error("No vector found or generated for Vector DB update, skipping create/add operation", db_path, "Either the embedding generator failed or no text was provided to embed"); 
        return false;
    }

    const dbToUse = dbs[_get_db_index(db_path)];
    const hash = _get_vector_hash(vector); if (!dbToUse.index[hash]) {  // only add the vector if we already don't have it
        dbToUse.index[hash] = {vector, hash, metadata, length: _getVectorLength(vector)};
        
        try {await fspromises.writeFile(_get_db_index_text_file(vector, db_path), text||"", "utf8");}
        catch (err) {
            delete dbToUse.index[hash]; 
            _log_error(`Vector DB text file ${_get_db_index_text_file(vector, db_path)} could not be saved`, db_path, err);
            return false;
        }
    }
    
    dbToUse.dirty = true; if (dbToUse.multithreaded) await _update_db_for_worker_threads();
    return vector;
}

exports.read = async (vector, notext, db_path) => {
    const hash = _get_vector_hash(vector); dbToUse = dbs[_get_db_index(db_path)];
    if (!dbToUse.index[hash]) return null;    // not found

    let text; 
    if (!notext) try {  // read the associated text unless told not to
        text = await fspromises.readFile(_get_db_index_text_file(vector, db_path), "utf8");
    } catch (err) { 
        _log_error(`Vector DB text file ${_get_db_index_text_file(vector, db_path)} not found or error reading`, db_path, err); 
        return null;
    }
    
    return {...dbToUse.index[hash], text};
}

exports.update = async (vector, metadata, text, embedding_generator, db_path) => {
    if (!vector) {_log_error("Update called without a proper index vector", db_path, "Vector to update not provided"); return false;}
    
    const hash = _get_vector_hash(vector), oldEntry = dbs[_get_db_index(db_path)].index[hash]; 
    if (!text) try {text = await fspromises.readFile(_get_db_index_text_file(vector, db_path), "utf8");} catch (err) {
        _log_error(`Vector DB text file ${_get_db_index_text_file(vector, db_path)} not found or error reading`, db_path, err); 
        return false;
    }
    if (!exports.add(vector, metadata, text, embedding_generator, db_path)) {   // re-adding actually overwrites everything, so it is an update
        dbs[_get_db_index(db_path)].index[hash] = oldEntry; // un-update
        return false;
    } else return vector;
}

exports.delete = async (vector, db_path) => {
    const dbToUse = dbs[_get_db_index(db_path)], hash = _get_vector_hash(vector); 
    if (!dbToUse.index[hash]) {
        _log_error("Delete called on a vector which is not part of the database", db_path, "Vector not found");
        return false; // not found
    }

    try {
        delete dbToUse.index[hash];
        dbToUse.dirty = true; if (dbToUse.multithreaded) await _update_db_for_worker_threads();
        await fspromises.unlink(_get_db_index_text_file(vector, db_path));
        return true;
    } catch (err) {
        _log_error(`Vector DB text file ${_get_db_index_text_file(vector, db_path)} could not be deleted`, db_path, err);
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
        filter_metadata_last, benchmarkIterations) {
    const dbToUse = dbs[_get_db_index(db_path)]; _log_info(`Searching ${Object.values(dbToUse.index).length} vectors.`, db_path);
    const _searchSimilarities = async _ => dbToUse.multithreaded ? await _search_multithreaded(db_path, 
        vectorToFindSimilarTo, (!filter_metadata_last)?metadata_filter_function:undefined) : _search_singlethreaded(
            dbToUse, vectorToFindSimilarTo, (!filter_metadata_last)?metadata_filter_function:undefined);
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

    if (!notext) for (const similarity_object of results) try { // read associated text, unless told not to
        similarity_object.text = await fspromises.readFile(_get_db_index_text_file(similarity_object.vector, db_path), "utf8");
    } catch (err) { 
        _log_error(`Vector DB text file ${_get_db_index_text_file(similarity_object.vector, db_path)} not found or error reading`, db_path, err); 
        return false;
    };

    return results; 
}

exports.ingest = async function(metadata, document, chunk_size, split_separators, overlap, embedding_generator, 
        db_path, return_tail_do_not_ingest) {

    const _find_split_separator = (split_start, raw_split_point) => {
        const rawChunk = document.substring(split_start, raw_split_point);
        let split_separator_to_use; for (const split_separator of Array.isArray(split_separators) ? split_separators : [split_separators])
            if (rawChunk.indexOf(split_separator) != -1) {split_separator_to_use = split_separator; break}
        if (!split_separator_to_use) return raw_split_point;    // seperator not found -- so go with it all as is
        const split_point = split_start+rawChunk.lastIndexOf(split_separator_to_use);
        return split_point;
    }

    let split_start = 0, split_end = (split_start+chunk_size) < document.length ? 
        _find_split_separator(split_start, split_start+chunk_size) : document.length;

    const vectorsToReturn = []; let tailChunkRemains = false;
    while (split_end <= document.length && (split_start != split_end)) {
        const split = document.substring(split_start, split_end).trim();
        const createdVector = await exports.create(undefined, metadata, split, embedding_generator, db_path);
        if (!createdVector) {
            _log_error("Unable to inject, creation failed", db_path, "Adding the new chunk failed");
            await _deleteAllCreatedVectors(vectorsToReturn);
            return false;
        } else vectorsToReturn.push(createdVector);

        if (split_end-overlap+chunk_size > document.length && return_tail_do_not_ingest) {tailChunkRemains = true; break;}
        split_start = split_end - overlap; split_end = (split_start+chunk_size) < document.length ? 
            _find_split_separator(split_start, split_start+chunk_size) : document.length;
    }

    return {vectors_ingested: vectorsToReturn, tail_chunk: tailChunkRemains ? document.substring(split_end) : undefined}
}

exports.uningest = async (vectors, db_path) => { for (const vector of vectors) await exports.delete(vector, db_path); }

exports.ingeststream = async function(metadata, stream, encoding="utf8", chunk_size, split_separators, overlap, embedding_generator, 
        db_path) {
    
    return new Promise((resolve, reject) => {
        let chunk_to_ingest = "", vectors_ingested = []; 
        stream.on("data", async chunk => {
            stream.pause(); // read more only after we ingest this first
            chunk_to_ingest += chunk.toString(encoding)
            if (chunk_to_ingest.length >= chunk_size) {
                const ingestionResult = await exports.ingest(metadata, chunk_to_ingest, chunk_size, split_separators, overlap, embedding_generator, db_path, true);
                if ((!ingestionResult) || (!ingestionResult.vectors_ingested)) {
                    _deleteAllCreatedVectors(vectors_ingested); stream.destroy("VectorDB ingestion failed."); return; }
                chunk_to_ingest = ingestionResult.tail_chunk||""; // whatever was left - start there next time
                vectors_ingested.push(...ingestionResult.vectors_ingested);
            }
            stream.resume();
        });

        stream.on("error", err => {
            if (err) LOG.error(`Read stream didn't close properly, ingestion failed. Related metadata was ${JSON.stringify(metadata)}.`);
            reject(err);
        });

        stream.on("end", async _ => {   
            if (chunk_to_ingest.trim() != "") { // ingest the remaining document tail which we read but didn't ingest before
                const ingestionResult_ending = await exports.ingest(metadata, chunk_to_ingest, chunk_size, 
                    split_separators, overlap, embedding_generator, db_path);
                if (!ingestionResult_ending) { _deleteAllCreatedVectors(vectors_ingested); 
                    stream.destroy("VectorDB ingestion failed."); reject("VectorDB ingestion failed."); return; }
                else vectors_ingested.push(...ingestionResult_ending.vectors_ingested);
            }
            resolve(vectors_ingested);
        });
    });
} 


exports.free = async db_path => {await flush_db(path); delete dbs[_get_db_index(db_path)];}   // free memory and unload

exports.get_vectordb = async function(path, embedding_generator, isMultithreaded, autosave=true, autosave_frequency=500) {
    await exports.initAsync(path, isMultithreaded); 
    let save_timer; if (autosave) save_timer = setInterval(_=>exports.save_db(path), autosave_frequency);
    return {
        create: async (vector, metadata, text) => exports.create(vector, metadata, text, embedding_generator, path),
        ingest: async (metadata, document, chunk_size, split_separators, overlap) => exports.ingest(metadata, document, 
            chunk_size, split_separators, overlap, embedding_generator, path),
        ingeststream: async(metadata, stream, encoding="utf8", chunk_size, split_separators, overlap) => 
            exports.ingeststream(metadata, stream, encoding, chunk_size, split_separators, overlap, 
                embedding_generator, path),
        read: async (vector, notext) => exports.read(vector, notext, path),
        update: async (vector, metadata, text) => exports.update(vector, metadata, text, embedding_generator, path),
        delete: async vector =>  exports.delete(vector, path),
        uningest: async vectors => exports.uningest(vectors, db_path),
        query: async (vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, filter_metadata_last, 
                benchmarkIterations) => exports.query(
            vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, path, filter_metadata_last, 
            benchmarkIterations),
        flush_db: async _ => exports.save_db(path),
        get_path: _ => path, get_embedding_generator: _ => embedding_generator,
        unload: async _ => {if (save_timer) clearInterval(save_timer); await exports.free(path);}
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
    let similarities = []; const lengthOfVectorToFindSimilarTo = vectorToFindSimilarTo?
        _getVectorLength(vectorToFindSimilarTo):undefined;
    for (const entryToCompareTo of Object.values(dbToUse.index)) 
        if (metadata_filter_function && metadata_filter_function(entryToCompareTo.metadata)) similarities.push({   // calculate cosine similarities
            vector: entryToCompareTo.vector, 
            similarity: vectorToFindSimilarTo ? _cosine_similarity(entryToCompareTo.vector, vectorToFindSimilarTo, 
                entryToCompareTo.length, lengthOfVectorToFindSimilarTo) : undefined,
            metadata: entryToCompareTo.metadata});
    return similarities;
}

async function _search_multithreaded(dbPath, vectorToFindSimilarTo, metadata_filter_function) {
    const lengthOfVectorToFindSimilarTo = vectorToFindSimilarTo?_getVectorLength(vectorToFindSimilarTo):undefined;
    const entries = Object.values(dbs[_get_db_index(dbPath)].index), splitLength = entries.length/maxthreads_for_search; 
    
    const _getSimilaritiesFromWorker = async (worker, start, end) => await _callWorker(worker,
        "calculate_cosine_similarity", [dbPath, start, end, vectorToFindSimilarTo, lengthOfVectorToFindSimilarTo, metadata_filter_function]);
    const _getSimilarityPushPromise = async (similarities, worker, start, end) => 
        similarities.push(...(await _getSimilaritiesFromWorker(worker, start, end)));
    let similarities = []; const searchPromises = []; 
    for (let split_num = 0;  split_num < maxthreads_for_search; split_num++) {
        const start = split_num*splitLength, end = ((split_num*splitLength)+splitLength > entries.length) ||
            (split_num ==  maxthreads_for_search - 1) ? entries.length : (split_num*splitLength)+splitLength;
        try { searchPromises.push(_getSimilarityPushPromise(similarities, worker, start, end)); } catch (err) {
            _log_error(`Error during similarity search in worker pools, the error is ${err}. Aborting.`);
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
    const db = dbs_worker[_get_db_index(dbPath)], arrayToCompareTo = Object.values(db.index).slice(startIndex, endIndex);
    const similarities = []; for (const entryToCompareTo of arrayToCompareTo) 
        if (metadata_filter_function && metadata_filter_function(entryToCompareTo.metadata)) similarities.push({   // calculate cosine similarities
            vector: entryToCompareTo.vector, 
            similarity: vectorToFindSimilarTo ? _cosine_similarity(entryToCompareTo.vector, vectorToFindSimilarTo, 
                entryToCompareTo.length, lengthOfVectorToFindSimilarTo) : undefined,
            metadata: entryToCompareTo.metadata});
    return similarities;
}

function _worker_setDatabase(dbsIn) {
    dbs_worker = dbsIn;
    (global.LOG||console).info(`DB set called on vector DB worker.`); return {result: true};
}
/*** End: worker module functions ***/

const _update_db_for_worker_threads = async _ => {for (const worker of workers) await _callWorker(worker, "setDatabase", 
    [dbs])}; // send DB to all workers

const _getVectorLength = v => Math.sqrt(v.reduce((accumulator, val) => accumulator + (val*val) ));

const _get_db_index = db_path => path.resolve(db_path);

const _get_db_index_file = db_path => path.resolve(`${db_path}/${DB_INDEX_NAME}`);

const _get_db_index_text_file = (vector, db_path) => path.resolve(`${db_path}/text_${_get_vector_hash(vector)}.txt`);

const _deleteAllCreatedVectors = async vectors => {for (const vector of vectors) await exports.delete(vector, db_path);}

function _get_vector_hash(vector) {
    const shasum = crypto.createHash("sha1"); shasum.update(vector.toString());
    const hash = shasum.digest("hex"); return hash;
}

const _log_error = (message, db_path, error) => (global.LOG||console).error(
    `${message}. The vector DB is ${_get_db_index(db_path)} and the DB index file is ${_get_db_index_file(db_path)}. The error was ${error||"no information"}.`);
const _log_info= (message, db_path) => (global.LOG||console).info(
    `${message}. The vector DB is ${_get_db_index(db_path)} and the DB index file is ${_get_db_index_file(db_path)}.`);