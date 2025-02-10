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
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/aidb.json`);
const textsplitter = require(`${NEURANET_CONSTANTS.LIBDIR}/textsplitter.js`);

const METADATA_DOCID_KEY_DEFAULT="aidb_docid", VECTORDB_FUNCTION_CALL_TOPIC = "vectordb.functioncall", workers = [];

let workers_initialized = false, blackboard_initialized = false, METADATA_DOCID_KEY, MULTITHREADED;

// Add in listeners for multi-threading support
if (!worker_threads.isMainThread) worker_threads.parentPort.on("message", async message => {    
    let result;
    if (message.function == "calculate_cosine_similarity") result = await _worker_calculate_cosine_similarity(...message.arguments);
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

    METADATA_DOCID_KEY = metadata_docid_key; MULTITHREADED = multithreaded;
    if (multithreaded && (!workers_initialized)) {  // create worker threads if we are multithreaded
        workers_initialized = true;
        const workersOnlinePromises = [];
        for (let i = 0; i < maxthreads_for_search; i++) workersOnlinePromises.push(new Promise(resolve => { //create workers
            const worker = new worker_threads.Worker(__filename);
            workers.push(worker); worker.on("online", resolve);
        }));
        await Promise.all(workersOnlinePromises);  // make sure all are online
    }

    if (!(await _checkFileAccess(db_path_in, fs.constants.R_OK))) {
        _log_error("Vector DB path folder does not exist. Initializing to an empty DB", db_path_in); 
        await memfs.mkdir(db_path_in, {recursive:true}); return;
    }
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

    if (!metadata[METADATA_DOCID_KEY]) throw new Error("Missing document ID in metadata.");

    const metadataHash = _get_metadata_hash(metadata), vectorHash = _get_vector_hash(vector, metadataHash); 
    if (!(await _read_vector_from_disk(db_path, vectorHash))) {  
        try {
            await memfs.writeFile(_get_db_vector_file(db_path, vectorHash), JSON.stringify(vector), "utf8");
            await memfs.writeFile(_get_db_text_file(db_path, vectorHash), text, "utf8");
        } catch (err) {
            await _delete_vector_from_db(db_path, vectorHash);
            _log_error(`Vector DB text file ${_get_db_text_file(db_path, vectorHash)} could not be saved`, db_path, err);
            return false;
        }
        try { 
            await _updateMetadataForVector(db_path, metadataHash, vectorHash, _getVectorLength(vector), metadata);
        } catch (err) {
            await _delete_vector_from_db(db_path, vectorHash); // deleting vector files if genarated
            await _updateMetadataForVector(db_path, metadataHash, vectorHash, undefined, undefined, true); // removing vector entries from metadata
            _log_error(`Error in removing vector entry from metadata for vectorHash ${vectorHash} and metadataHash ${metadataHash}`, db_path, err);
            return false;
        }
    }
    
    _log_info(`Added vector ${vector} with vectorHash ${vectorHash} and metadataHash ${metadataHash} to DB.`, db_path, true);
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
    const metadataJSON = await _get_metadata_JSON(db_path);
    const metadataHash = _get_metadata_hash(metadata), vectorHash = _get_vector_hash(vector, metadataHash);
    const vectorArray = await _read_vector_from_disk(db_path, vectorHash);
    if (!vectorArray || !metadataJSON[metadataHash]) return null;    // not found
    const vectorLength = metadataJSON[metadataHash].vectors[vectorHash];

    let text; if (!notext) try {  // read the associated text unless told not to, don't cache these files
        text = await memfs.readFile(_get_db_text_file(db_path, hash), {encoding: "utf8", memfs_dontcache: true});
    } catch (err) { 
        _log_error(`Vector DB text file ${_get_db_text_file(db_path, hash)} not found or error reading`, db_path, err); 
        return null;
    }
    
    return {vector: vectorArray, text, hash: vectorHash, metadata: metadataJSON[metadataHash].metadata, length: vectorLength};
}

/**
 * Updates the vector DB's vector with the new information provided.
 * @param {object} oldmetadata The old metadata
 * @param {object} newmetadata The new metadata
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @throws Exception on errors 
 */
exports.update = async (oldMetadata, newMetadata, db_path) => {
    return await _updateAllMetadataVectors(_get_metadata_hash(oldMetadata), newMetadata, db_path);
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
    
    const _searchSimilarities = async relatedVectorsObjects => {
        const similaritiesOtherReplicas = MULTITHREADED && (!_forceSingleNode) ? 
            await _getDistributedSimilarities([vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, 
                notext, db_path, filter_metadata_last, benchmarkIterations]) : [];
        const similaritiesThisReplica = MULTITHREADED ? 
            await _search_multithreaded(vectorToFindSimilarTo, relatedVectorsObjects) :
            _search_singlethreaded(vectorToFindSimilarTo, relatedVectorsObjects);
        const similaritiesFinal = [...similaritiesOtherReplicas, ...similaritiesThisReplica];
        return similaritiesFinal;
    };

    const relatedVectorsObjects = await _get_related_vectors_for_db(db_path, metadata_filter_function);
  
    let similarities; if (benchmarkIterations) {
        _log_error(`Vector DB is in benchmarking mode. Performance will be affected. Iterations = ${benchmarkIterations}. DB index size = ${relatedVectorsObjects.length} vectors. Total simulated index size to be searched = ${parseInt(process.env.__ORG_MONKSHU_VECTORDB_BENCHMARK_ITERATIONS)*relatedVectorsObjects.length} vectors.`, db_path);
        for (let i = 0; i < benchmarkIterations; i++) similarities = await _searchSimilarities(relatedVectorsObjects);
    } else similarities = await _searchSimilarities(relatedVectorsObjects);
        
    if (vectorToFindSimilarTo) similarities.sort((a,b) => b.similarity - a.similarity);

    if (!notext) for (const similarity_object of similarities) {
        if(similarity_object.text) continue; // already has the text,no need to get the text
        const vectorHash = _get_vector_hash(similarity_object.vector, _get_metadata_hash(similarity_object.metadata)), 
            textFile = _get_db_text_file(db_path, vectorHash);
        try { // read associated text, unless told not to
            similarity_object.text = await memfs.readFile(textFile, "utf8");
        } catch (err) { 
            _log_error(`Vector DB text file ${textFile} not found or error reading`, db_path, err); return false; }
    } return similarities; 
}

/**
 * Deletes the given vectors from the DB.
 * @param {object} metadata The associated metadata
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 */
exports.uningest = async (metadata, db_path) => { 
    return await _deleteAllDBVectorObjects(_get_metadata_hash(metadata), db_path);
}

/**
 * Ingests a stream into the database. Memory efficient and should be the function of choice to use
 * for ingesting large documents into the database. 
 * @param {object} metadata The associated metadata
 * @param {object} stream The incoming text data stream (must be text)
 * @param {string} encoding The encoding for the text stream, usually UTF8
 * @param {number} chunk_size The chunk size - must be less than what is the maximum for the embedding_generator, it is in bytes
 * @param {array} split_separators The characters on which we can split
 * @param {number} overlap The overlap characters for each split. Not sure this is useful, usually 0 should be ok.
 * @param {function} embedding_generator The embedding generator, see create for format
 * @param {string} db_path The DB path where this DB is stored. Must be a folder.
 * @returns {array} true on success or throws errors otherwise
 * @throws Errors if things go wrong.
 */
exports.ingeststream = async function(metadata, stream, encoding="utf8", chunk_size, split_separators, overlap, embedding_generator, 
        db_path) {

    return new Promise((resolve, reject) => {
        let working_data = Buffer.alloc(0), had_error = false, waitingPromises = [];

        const _splitWorkingData = forceLastSplit => {
            const splits = textsplitter.getSplits(working_data.toString(encoding), chunk_size, split_separators, overlap);
            if (splits.length) {
                const processLastSplit = forceLastSplit ? true : (splits[splits.length-1].length < 0.5*chunk_size) ? false : true;    // if last split is > 50% of chunk size wanted, just process it 
                if (!processLastSplit) working_data = Buffer.from(splits[splits.length-1]); else working_data = Buffer.alloc(0);
                const splitsToIngest = processLastSplit ? splits : splits.slice(0, -1);
                return splitsToIngest;
            } else return [];
        }

        const _handleError = async err => {
            had_error = true; await _deleteAllDBVectorObjects(_get_metadata_hash(metadata), db_path, false);
            _log_error(`Vector ingection failed, the related metadata was ${JSON.stringify(metadata)}`, db_path, err); 
            reject(err);
        }

        const _ingestSingleSplit = async split => {
            if (had_error) return;  // ignore new data if old ingestions failed
            const createdVector = await exports.create(undefined, metadata, split, embedding_generator, db_path);
            if (!createdVector)_handleError("Unable to inject, creation failed, adding new chunk failed");
        }

        stream.on("data", chunk => {
            if (had_error) return;  // ignore new data if old ingestions failed
            working_data = Buffer.concat([working_data, chunk]);
            const splitsToIngest = _splitWorkingData();
            for (const split of splitsToIngest) waitingPromises.push(_ingestSingleSplit(split));
        });

        stream.on("error", err => {
            if (had_error) return;  // ignore new errors if old ingestions failed
            _handleError(`Read stream didn't close properly, ingestion failed. Error was ${err.toString()}`);
        });

        stream.on("end", async _=> {
            if (had_error) return;  // we have already rejected then 
            const splitsToIngest = _splitWorkingData(true); // ingest whatever remains
            for (const split of splitsToIngest) waitingPromises.push(_ingestSingleSplit(split));
            try {await Promise.all(waitingPromises); resolve(true);} catch(err) {reject(err);} 
        });
    });
} 


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
    return {
        create: async (vector, metadata, text) => await exports.create(vector, metadata, text, embedding_generator, db_path),
        ingeststream: async(metadata, stream, encoding="utf8", chunk_size, split_separators, overlap) => 
            exports.ingeststream(metadata, stream, encoding, chunk_size, split_separators, overlap, 
                embedding_generator, db_path),
        read: async (vector, metadata, notext) => await exports.read(vector, metadata, notext, db_path),
        update: async (oldMetadata, newMetadata) => await exports.update(oldMetadata, newMetadata, db_path),    
        uningest: async (metadata) => await exports.uningest(metadata, db_path),
        query: async (vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, 
            filter_metadata_last, benchmarkIterations) => await exports.query(vectorToFindSimilarTo, topK, 
                min_distance, metadata_filter_function, notext, db_path, filter_metadata_last, benchmarkIterations),
        get_path: _ => db_path, 
        get_embedding_generator: _ => embedding_generator,
        sort: vectorResults => vectorResults.sort((a,b) => b.similarity - a.similarity),
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

function _search_singlethreaded(vectorToFindSimilarTo, relatedVectorsObjects) {
    const similarities = [], lengthOfVectorToFindSimilarTo = vectorToFindSimilarTo?
        _getVectorLength(vectorToFindSimilarTo):undefined;
    for (const entryToCompareTo of relatedVectorsObjects) { 
        similarities.push({   // calculate cosine similarities
            vector: entryToCompareTo.vector, 
            similarity: vectorToFindSimilarTo ? _cosine_similarity(entryToCompareTo.vector, vectorToFindSimilarTo, 
                entryToCompareTo.length, lengthOfVectorToFindSimilarTo) : undefined,
            metadata: entryToCompareTo.metadata
        });
    } return similarities;
}

async function _search_multithreaded(vectorToFindSimilarTo, entries) {
    const lengthOfVectorToFindSimilarTo = vectorToFindSimilarTo?_getVectorLength(vectorToFindSimilarTo):undefined;
    const splitLength = entries.length/maxthreads_for_search; 
    
    const _getSimilaritiesFromWorker = async (worker, entries) => await _callWorker(worker,
        "calculate_cosine_similarity", [entries, vectorToFindSimilarTo, lengthOfVectorToFindSimilarTo]);
    const _getSimilarityPushPromise = async (similarities, worker, entries) => 
        similarities.push(...(await _getSimilaritiesFromWorker(worker, entries)));
    const similarities = [], searchPromises = []; 
    for (let split_num = 0;  split_num < maxthreads_for_search; split_num++) {
        const start = split_num*splitLength, end = ((split_num*splitLength)+splitLength > entries.length) ||
            (split_num ==  maxthreads_for_search - 1) ? entries.length : (split_num*splitLength)+splitLength;
        try { searchPromises.push(_getSimilarityPushPromise(similarities, worker, entries.slice(start, end))); } catch (err) {
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
async function _worker_calculate_cosine_similarity(entries, vectorToFindSimilarTo, lengthOfVectorToFindSimilarTo) {
    const similarities = []; for (const entryToCompareTo of entries) {
        similarities.push({   // calculate cosine similarities
            vector: entryToCompareTo.vector, 
            similarity: vectorToFindSimilarTo ? _cosine_similarity(entryToCompareTo.vector, vectorToFindSimilarTo, 
                entryToCompareTo.length, lengthOfVectorToFindSimilarTo) : undefined,
            metadata: entryToCompareTo.metadata});
    } return similarities;
}
/*** End: worker module functions ***/


async function _get_related_vectors_for_db(db_path, metadata_filter_function){
    const metadataJSON = await _get_metadata_JSON(db_path);
    const metadataObjects = Object.values(metadataJSON).filter(metadataObject => 
        !metadata_filter_function || metadata_filter_function(metadataObject.metadata)); // filter-out all metadataObjects
    return await _get_all_metadata_related_vectors(metadataObjects, db_path);   // get the related vectorObjects for search
}

async function _get_all_metadata_related_vectors(metadataObjects, db_path) {
    let relatedVectors = []; for (const metadataObject of metadataObjects) {
        for (const vectorHash of Object.keys(metadataObject?.vectors)) {
            relatedVectors.push({vector: (await _read_vector_from_disk(db_path, vectorHash)), hash: vectorHash, 
                length: metadataObject?.vectors[vectorHash], metadata: metadataObject.metadata});
        }
    } return relatedVectors;
}

const _getVectorLength = v => Math.sqrt(v.reduce((accumulator, val) => accumulator + (val*val) ));

const _get_db_index = db_path => path.resolve(db_path);

const _get_db_text_file = (db_path, hash) => path.resolve(`${db_path}/${hash}.text`);

const _get_db_vector_file = (db_path, hash) => path.resolve(`${db_path}/${hash}.vector`);

const _get_db_metadata_file = db_path => path.resolve(`${db_path}/metadata.json`);

const _get_metadata_JSON = async db_path => {
    const metadataFileath = _get_db_metadata_file(db_path);
    if(!(await _checkFileAccess(metadataFileath))) { 
        await memfs.writeFile(metadataFileath, JSON.stringify({}), 'utf-8');   // initialize a empty metaData file if not exists
        return {};
    } return JSON.parse(await memfs.readFile(metadataFileath));
}

const _read_vector_from_disk = async (db_path, hash, options) => { 
    const vectorFilePath = _get_db_vector_file(db_path, hash);
    if(!(await _checkFileAccess(vectorFilePath))) return false;
    return JSON.parse(await memfs.readFile(vectorFilePath, options));
};

function _get_vector_hash(vector, metadataHash) {
    const hashAlgo = crypto.createHash("md5"); hashAlgo.update(`${vector.toString() + metadataHash}`);
    const hash = hashAlgo.digest("hex"); return hash;
}

function _get_metadata_hash(metadata) {
    const hashAlgo = crypto.createHash("md5"); hashAlgo.update(`${metadata.fullpath + metadata[METADATA_DOCID_KEY]}`);
    const hash = hashAlgo.digest("hex"); return hash;
}

async function _checkFileAccess(filepath, mode) {
    try { await memfs.access(filepath, mode); return true; } 
    catch (err) { return false; }
}

const _delete_all_vectors_from_db = async (hashes, db_path) => { for (const hash of hashes) { await _delete_vector_from_db(db_path, hash)} };

async function _delete_vector_from_db(db_path, hash) {
    await memfs.unlinkIfExists(_get_db_vector_file(db_path, hash));
    await memfs.unlinkIfExists(_get_db_text_file(db_path, hash));
}

const _update_all_vectors_from_db = async (hashes, db_path, newMetadata) => { 
    const vectors = {};
    for (const hash of hashes) { 
        const {vectorHash, length} = await _update_vector_from_db(db_path, hash, newMetadata);
        vectors[vectorHash] = length;
    } return vectors;
};

async function _update_vector_from_db(db_path, hash, newMetadata) {
    const vector = await _read_vector_from_disk(db_path, hash, {encoding: "utf8", memfs_dontcache: true});
    const text = await memfs.readFile(_get_db_text_file(db_path, hash), {encoding: "utf8", memfs_dontcache: true});
    _delete_vector_from_db(db_path, hash); // do not await for old vector delete
    const newHash = _get_vector_hash(vector, _get_metadata_hash(newMetadata));
    await memfs.writeFile(_get_db_vector_file(db_path, newHash), JSON.stringify(vector), "utf8");
    await memfs.writeFile(_get_db_text_file(db_path, newHash), text, "utf8");
    return {vectorHash: newHash, length: _getVectorLength(vector)};
}

async function _updateMetadataForVector(db_path, metadataHash, vectorHash, vectorLength, metadata, deleteFlag=false){
    const metaDataJSON = await _get_metadata_JSON(db_path);
    if(!deleteFlag){
        if(!metaDataJSON[metadataHash]) metaDataJSON[metadataHash] = _createMetadataObj(metadata, metadataHash);  // insert any empty Object if no metada Object found for metadataHash
        metaDataJSON[metadataHash].vectors[vectorHash] = vectorLength;  // inserting vectorHash with it's vectorLength
        metaDataJSON[metadataHash].time = Date.now();
    } else {
        if(!metaDataJSON[metadataHash]) return;
        delete metaDataJSON[metadataHash].vectors[vectorHash];
        metaDataJSON[metadataHash].time = Date.now();
        if(metaDataJSON[metadataHash].vectors = {}) delete metaDataJSON[metadataHash]; // delete hash entry if all vectors deleted
    }

    await memfs.writeFile(_get_db_metadata_file(db_path), JSON.stringify(metaDataJSON), 'utf-8');   // overwritig meta file after operation
}

async function _deleteAllDBVectorObjects(metadataHash, db_path, publish=true) {
    try {
        const metadataJSON = await _get_metadata_JSON(db_path);
        if (!metadataJSON[metadataHash]) { 
            if (publish) {  // we do not have this metadataHash, maybe someone else does, just broadcast it
                const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;
                const msg = {dbinitparams: _createDBInitParams(dbToUse), function_params: [metadataHash, db_path, false], 
                    function_name: "_deleteAllDBVectorObject", is_function_private: true, send_reply: false};
                blackboard.publish(VECTORDB_FUNCTION_CALL_TOPIC, msg, bboptions); 
                return false;   // not found locally
            } else return true; // we already don't have this, so deletion is "sort of" successful
        } 

        _delete_all_vectors_from_db(Object.keys(metadataJSON[metadataHash].vectors), db_path); // do not await for deleting the vectors
        delete metadataJSON[metadataHash]; await memfs.writeFile(_get_db_metadata_file(db_path), JSON.stringify(metadataJSON), 'utf-8');
        return true;    // found locally
    } catch (err) {
        _log_error(`Vectors or the associated text files could not be deleted for metadataHash ${metadataHash}`, db_path, err);
        return false;
    }
}

async function _updateAllMetadataVectors(metadataHash, newMetadata, db_path, publish=true) {
    try {
        const metadataJSON = await _get_metadata_JSON(db_path);
        if (!metadataJSON[metadataHash]) { 
            if (publish) {  // we do not have this metadataHash, maybe someone else does, just broadcast it
                const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;
                const msg = {dbinitparams: _createDBInitParams(dbToUse), function_params: [metadataHash, newMetadata, db_path, false], 
                    function_name: "_updateAllMetadataVectors", is_function_private: true, send_reply: false};
                blackboard.publish(VECTORDB_FUNCTION_CALL_TOPIC, msg, bboptions); 
                return false;   // not found locally
            } else return true; // we already don't have this, so deletion is "sort of" successful
        } 

        const newmetadataHash = _get_metadata_hash(newMetadata);
        metadataJSON[newmetadataHash] = _createMetadataObj(newMetadata, newmetadataHash);
        const updatedVectors = await _update_all_vectors_from_db(Object.keys(metadataJSON[metadataHash].vectors), db_path, newMetadata);
        metadataJSON[newmetadataHash].vectors = updatedVectors;
        metadataJSON[newmetadataHash].time = Date.now();
        delete metadataJSON[metadataHash]; 
        await memfs.writeFile(_get_db_metadata_file(db_path), JSON.stringify(metadataJSON), 'utf-8');
        return true;    // found locally
    } catch (err) {
        _log_error(`Vectors or the associated text files could not be updated for metadataHash ${metadataHash}`, db_path, err);
        return false;
    }
}

function _initBlackboardHooks() {
    const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;

    blackboard.subscribe(VECTORDB_FUNCTION_CALL_TOPIC, async msg => {
        const {dbinitparams, function_name, function_params, is_function_private, send_reply, blackboardcontrol} = msg;
        if (!(await _checkFileAccess(dbinitparams.dbpath))) {LOG.error(`Missing DB path for message ${JSON.stringify(msg)}`); return;}

        const functionToCall = is_function_private ? private_functions[function_name] : module.exports[function_name];
        let function_result;
        if (send_reply) function_result = await functionToCall(...function_params); else await functionToCall(...function_params);
        if (send_reply) blackboard.sendReply(VECTORDB_FUNCTION_CALL_TOPIC, blackboardcontrol, {reply: function_result});
    }, bboptions);
}

async function _getDistributedSimilarities(query_params) {
    const [_vectorToFindSimilarTo, _topK, _min_distance, _metadata_filter_function, _notext, db_path, 
        _filter_metadata_last, _benchmarkIterations] = query_params;

    const bboptions = {}; bboptions[blackboard.EXTERNAL_ONLY] = true;
    const msg = { dbinitparams: _createDBInitParams(db_path), function_params: [...query_params, true], 
        function_name: "query", is_function_private: false, send_reply: true };
    const replies = await _getDistributedResultFromFunction(msg);
    if (replies.incomplete) _log_warning(`Received incomplete replies for the query. Results not perfect.`, db_path);
    const similarities = []; for (const replyObject of replies||[]) if (replyObject.reply) similarities.push(...(replyObject.reply));
    return similarities;
}

function _getDistributedResultFromFunction(msg, bboptions) {
    return new Promise(resolve => blackboard.getReply(VECTORDB_FUNCTION_CALL_TOPIC, 
        msg, conf.cluster_timeout, bboptions, replies=>resolve(replies)));
}

const _createMetadataObj = (metadata, metadataHash) => Object({metadata, metadataHash, vectors: {}, 
    time: Date.now()});
const _createDBInitParams = db_path => {return { db_path, metadata_docid_key: METADATA_DOCID_KEY, 
    multithreaded: MULTITHREADED }};
const _log_warning = (message, db_path) => (global.LOG||console).warn(
    `${message}. The vector DB is ${_get_db_index(db_path)}.`);
const _log_error = (message, db_path, error) => (global.LOG||console).error(
    `${message}. The vector DB is ${_get_db_index(db_path)}. The error was ${error||"no information"}.`);
    const _log_info = (message, db_path, isDebug) => (global.LOG||console)[isDebug?"debug":"info"](
    `${message}. The vector DB is ${_get_db_index(db_path)}.`);
    
const private_functions = {_deleteAllDBVectorObjects, _updateAllMetadataVectors};  // private functions which can be called via distributed function calls