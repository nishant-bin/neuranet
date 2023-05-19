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
 * Supports CRUD operations on the index, and query to return topK
 * matching vectors.
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
 * Flat indexing takes about 200 ms on a 2 core, 6 GB RAM box with 5,000 documents to
 * search. May be faster on modern processors or GPUs.
 * 
 * TODO: An upcoming new algorithm for fast, 100% accurate exhaustive search would be
 * added by Tekmonks once testing is completed. Making this the easiest, and a really 
 * fast vector database for all types of production loads and AI applications.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */
const fs = require("fs");
const path = require("path");
const fspromises = fs.promises;
const crypto = require("crypto");

const dbs = {}, DB_INDEX_NAME = "dbindex.json", DB_INDEX_OBJECT_TEMPLATE = {index:{}, dirty: false};

exports.initSync = db_path_in => {
    dbs[_get_db_index(db_path_in)] = {...DB_INDEX_OBJECT_TEMPLATE}; // init to an empty db

    if (!fs.existsSync(db_path_in)) {
        _log_error("Vector DB path folder does not exist. Initializing to an empty DB", db_path_in, "Folder not found"); 
        fs.mkdirSync(db_path_in, {recursive:true});
        return;
    }
    
    try {
        const db = require(_get_db_index_file(db_path_in)); 
        dbs[_get_db_index(db_path_in)] = db;
    } catch (err) {
        _log_error("Vector DB index does not exist, or read error. Initializing to an empty DB", db_path_in, err); 
    }
}

exports.initAsync = async db_path_in => {
    dbs[_get_db_index(db_path_in)] = {...DB_INDEX_OBJECT_TEMPLATE}; // init to an empty db

    try {await fspromises.access(db_path_in, fs.constants.R_OK)} catch (err) {
        _log_error("Vector DB path folder does not exist. Initializing to an empty DB", db_path_in, err); 
        await fspromises.mkdir(db_path_in, {recursive:true});
        return;
    }

    try {
        const db = JSON.parse(await fspromises.readFile(_get_db_index_file(db_path_in), "utf8"));
        dbs[_get_db_index(db_path_in)] = db
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
    
    dbToUse.dirty = true;
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
    
    const oldEntry = dbs[_get_db_index(db_path)].index[hash];
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
        await fspromises.unlink(_get_db_index_text_file(vector, db_path));
        delete dbToUse.index[hash];
        dbToUse.dirty = true;
        return true;
    } catch (err) {
        _log_error(`Vector DB text file ${_get_db_index_text_file(vector, db_path)} could not be deleted`, db_path, err);
        return false;
    }
}

exports.query = async function(vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, db_path) {
    let similarities = []; 
    const dbToUse = dbs[_get_db_index(db_path)], lengthOfVectorToFindSimilarTo = _getVectorLength(vectorToFindSimilarTo);
    
    for (const entryToCompareTo of Object.values(dbToUse.index)) similarities.push({   // calculate cosine similarities
        vector: entryToCompareTo.vector, 
        similarity: _cosine_similarity(entryToCompareTo.vector, vectorToFindSimilarTo, 
            entryToCompareTo.length, lengthOfVectorToFindSimilarTo),
        metadata: entryToCompareTo.metadata});

    similarities.sort((a,b) => b.similarity - a.similarity);
    let results = [...similarities.slice(0, topK < similarities.length ? topK : similarities.length)]; 
    similarities = []; // try to free memory asap

    // filter for minimum distance if asked
    if (min_distance) results = results.filter(similarity_object => similarity_object.similarity >= min_distance);

    // filter the results further by conditioning on the metadata, if a filter was provided
    if (metadata_filter_function) results = results.filter(similarity_object => metadata_filter_function(similarity_object.metadata));

    if (!notext) for (const similarity_object of results) try { // read associated text, unless told not to
        similarity_object.text = await fspromises.readFile(_get_db_index_text_file(similarity_object.vector, db_path), "utf8");
    } catch (err) { 
        _log_error(`Vector DB text file ${_get_db_index_text_file(similarity_object.vector, db_path)} not found or error reading`, db_path, err); 
        return false;
    };

    return results; 
}

exports.ingest = async function(metadata, document, chunk_size, split_separator, overlap, embedding_generator, db_path) {
    const _find_split_separator = (split_start, raw_split_point) => {
        const rawChunk = document.substring(split_start, raw_split_point);
        const split_point = split_start+rawChunk.lastIndexOf(split_separator);
        if (split_point == -1) return raw_split_point;    // seperator not found -- so go with it all as is
        else return split_point;
    }

    let split_start = 0, split_end = (split_start+chunk_size) < document.length ? 
        _find_split_separator(split_start, split_start+chunk_size) : document.length;

    const _deleteAllCreatedVectors = async vectors => {for (const vector of vectors) await exports.delete(vector, db_path);}

    const vectorsToReturn = [];
    while (split_end <= document.length && (split_start != split_end)) {
        const split = document.substring(split_start, split_end).trim();
        split_start = split_end - overlap; split_end = (split_start+chunk_size) < document.length ? 
            _find_split_separator(split_start, split_start+chunk_size) : document.length;
        const createdVector = await exports.create(undefined, metadata, split, embedding_generator, db_path);
        if (!createdVector) {
            _log_error("Unable to inject, creation failed", db_path, "Adding the new chunk failed");
            await _deleteAllCreatedVectors(vectorsToReturn);
            return false;
        } else vectorsToReturn.push(createdVector);
    }

    return vectorsToReturn;
}

exports.uningest = async (vectors, db_path) => { for (const vector of vectors) await exports.delete(vector, db_path); }

exports.free = async db_path => {await flush_db(path); delete dbs[_get_db_index(db_path)];}   // free memory and unload

exports.get_vectordb = async function(path, embedding_generator, autosave=true, autosave_frequency=500) {
    await exports.initAsync(path); 
    let save_timer; if (autosave) save_timer = setInterval(_=>exports.save_db(path), autosave_frequency);
    return {
        create: async (vector, metadata, text) => exports.create(vector, metadata, text, embedding_generator, path),
        ingest: async (metadata, document, chunk_size, split_separator, overlap) => exports.ingest(metadata, document, chunk_size, split_separator, overlap, embedding_generator, path),
        read: async (vector, notext) => exports.read(vector, notext, path),
        update: async (vector, metadata, text) => exports.update(vector, metadata, text, embedding_generator, path),
        delete: async vector =>  exports.delete(vector, path),
        uningest: async vectors => exports.uningest(vectors, db_path),
        query: async (vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext) => exports.query(
            vectorToFindSimilarTo, topK, min_distance, metadata_filter_function, notext, path),
        flush_db: async _ => exports.save_db(path),
        get_path: _ => path, get_embedding_generator: _ => embedding_generator,
        unload: async _ => {if (save_timer) clearInterval(save_timer); await exports.free(path);}
    }
}

function _cosine_similarity(v1, v2, lengthV1, lengthV2) {
    if (v1.length != v2.length) throw Error(`Can't calculate cosine similarity of vectors with unequal dimensions, v1 dimensions are ${v1.length} and v2 dimensions are ${v2.length}.`);
    const vector_product = v1.reduce((accumulator, v1Value, v1Index) => accumulator + (v1Value * v2[v1Index]), 0);
    if (!lengthV1) lengthV1 = _getVectorLength(v1); if (!lengthV2) lengthV2 = _getVectorLength(v2);
    const cosine_similarity = vector_product/(lengthV1*lengthV2);
    return cosine_similarity;
}

const _getVectorLength = v => Math.sqrt(v.reduce((accumulator, val) => accumulator + (val*val) ));

const _get_db_index = db_path => path.resolve(db_path);

const _get_db_index_file = db_path => path.resolve(`${db_path}/${DB_INDEX_NAME}`);

const _get_db_index_text_file = (vector, db_path) => path.resolve(`${db_path}/text_${_get_vector_hash(vector)}.txt`);

function _get_vector_hash(vector) {
    const shasum = crypto.createHash("sha1"); shasum.update(vector.toString());
    const hash = shasum.digest("hex"); return hash;
}

const _log_error = (message, db_path, error) => (LOG||console).error(
    `${message}. The vector DB is ${_get_db_index(db_path)} and the DB index file is ${_get_db_index_file(db_path)}. The error was ${error}.`);