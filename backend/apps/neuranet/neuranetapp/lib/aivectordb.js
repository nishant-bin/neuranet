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
const queue_executor = require(`${CONSTANTS.LIBDIR}/queueExecutor.js`);

const dbs = {}, DB_INDEX_NAME = "index.json";

exports.initSync = db_path_in => {
    dbs[_get_db_index(db_path_in)] = {vector_index: [], metadatas: {}}; // init to an empty index

    if (!fs.existsSync(db_path_in)) {
        LOG.error(`Vector DB path folder ${db_path_in} does not exist. Initializing to an empty DB. The error was ${err}.`); 
        fs.mkdirSync(db_path_in);
        return;
    }
    
    try {
        const db = require(_get_db_index_file(db_path_in)); 
        dbs[_get_db_index(db_path_in)] = {vector_index: db.vector_index, metadatas: db.metadatas};
    } catch (err) {
        LOG.error(`Vector DB path ${_get_db_index_file(db_path_in)} does not exist. Initializing to an empty DB. The error was ${err}.`); 
    }
}

exports.initAsync = async db_path_in => {
    dbs[_get_db_index(db_path_in)] = {vector_index: [], metadatas: {}}; // init to an empty index

    try {await fspromises.access(db_path_in, fs.constants.R_OK)} catch (err) {
        LOG.error(`Vector DB path folder ${index_file_path} does not exist. Initializing to an empty DB.`); 
        await fspromises.mkdir(db_path_in);
        return;
    }

    try {dbs[_get_db_index(db_path_in)] = JSON.parse(await fspromises.readFile(_get_db_index_file(db_path_in), "utf8"))} catch (err) {
        LOG.error(`Vector DB path ${_get_db_index_file(db_path_in)} does not exist. Initializing to an empty DB. The error was ${err}.`); 
    }
    
}

exports.save_db = async db_path_out => {
    const db_to_save = dbs[_get_db_index(db_path_out)]; if (!db_to_save) {
        LOG.error(`Nothing to save in save_db call. The DB index called to save was ${_get_db_index_file(db_path_out)}.`);
        return;
    }

    try {await fspromises.writeFile(_get_db_index_file(db_path_out), JSON.stringify(db_to_save))}
    catch (err) {
        LOG.error(`Vector DB path ${_get_db_index_file(db_path_out)} write error. The error was ${err}.`); 
    }
}

exports.create = exports.add = async (vector, metadata, text, embedding_generator, db_path) => {
    if ((!vector) && embeddingGenerator && text) vector = await embedding_generator(text);
    if (!vector) {LOG.error(`No vector found or generated for VectoDB create.`); return;}    // nothing to do

    dbs[_get_db_index(db_path)].vector_index.push(vector);
    dbs[_get_db_index(db_path)].metadatas[vector.toString()] = metadata;
    await fspromises.writeFile(_get_db_index_text_file(vector, db_path), text||"", "utf8");

    queue_executor.add(exports.save_db, [db_path], true);   // DB modified so save it as a queued server task
}

exports.read = async (vector, db_path) => {
    const metadata = dbs[_get_db_index(db_path)].metadatas[vector.toString()];
    let text; try {text = fspromises.readFile(_get_db_index_text_file(vector, db_path), "utf8");} catch (err) {
        LOG.warn(`No text found or error reading text for the vector ${vector} for db_path ${db_path}. The error was ${err}.`);
    }
    return {vector, metadata, text};
}

exports.update = async (vector, metadata, text, embedding_generator, db_path) => {
    if ((!vector) && embeddingGenerator && text) vector = await embedding_generator(text);
    if (!vector) {LOG.error(`No vector found or generated for VectoDB update.`); return;}    // nothing to do

    dbs[_get_db_index(db_path)].metadatas[vector.toString()] = metadata; 
    await fspromises.writeFile(_get_db_index_text_file(vector, db_path), text||"", "utf8");

    queue_executor.add(exports.save_db, [db_path], true);   // DB modified so save it as a queued server task
}

exports.delete = async (vector, db_path) => {
    const foundAtIndex = dbs[_get_db_index(db_path)].vector_index.indexOf(vector); 
    if (foundAtIndex == -1) return; // not found
    dbs[_get_db_index(db_path)].vector_index.splice(foundAtIndex, 1); 
    delete dbs[_get_db_index(db_path)].metadatas[vector.toString()];
    try {await fspromises.unlink(_get_db_index_text_file(vector, db_path));} catch (err) {
        LOG.warn(`Error deleting text document corresponding to the vector ${vector} at db_path ${db_path}. The error was ${err}.`);
    }
    
    queue_executor.add(exports.save_db, [db_path], true);   // DB modified so save it as a queued server task
}

exports.query = async function(vectorToFindSimilarTo, topK, min_distance, db_path) {
    const similarities = [];
    for (const vectorToCompareTo of dbs[_get_db_index(db_path)].vector_index) similarities.push({
        vector: vectorToCompareTo, 
        similarity: _cosine_similarity(vectorToCompareTo, vectorToFindSimilarTo),
        metadata: documents[vectorToCompareTo.toString()]});
    similarities.sort(a,b => a.similarity - b.similarity);
    const result = [...similarities.slice(0, topK)]; similarities = []; // try to free memory asap

    // filter for minimum distance if asked
    if (min_distance) result = result.filter(value => value >= min_distance);

    for (const result of results) try {
        result.text = await fspromises.readFile(_get_db_index_text_file(result.vector, db_path), "utf8");
    } catch (err) {
        LOG.warn(`No text found for the vector ${result.vector.toString()} for db_path ${db_path}. The error was ${err}.`);
    }

    return result; 
}

exports.get_vectordb = async function(path, embedding_generator) {
    await exports.initAsync(path); 
    return {
        create: async (vector, metadata, text) => exports.create(vector, metadata, text, embedding_generator, path),
        read: async vector => exports.read(vector, path),
        update: async (vector, metadata, text) => exports.update(vector, metadata, text, embedding_generator, path),
        delete: async vector =>  exports.delete(vector, path),
        query: async (vectorToFindSimilarTo, topK, min_distance) => exports.query(vectorToFindSimilarTo, topK, min_distance, path),
        flush_db: async _ => exports.save_db(path),
        get_path: _ => path, get_embedding_generator: _ => embedding_generator
    }
}

function _cosine_similarity(v1, v2) {
    if (v1.length != v2.length) throw Error(`Can't calculate cosine similarity of vectors with unequal dimensions, v1 dimensions are ${v1.length} and v2 dimensions are ${v2.length}.`);
    const vector_product = v1.reduce((accumulator, v1Value, v1Index) => accumulator + (v1Value * v2[v1Index]), 0);
    const lengthV1 = Math.sqrt(v1.reduce((accumulator, val) => accumulator + (val*val) ));
    const lengthV2 = Math.sqrt(v2.reduce((accumulator, val) => accumulator + (val*val) ));
    const cosine_similarity = vector_product/(lengthV1*lengthV2);
    return cosine_similarity;
}

const _get_db_index = db_path => path.resolve(db_path);

const _get_db_index_file = db_path => path.resolve(`${db_path}/${DB_INDEX_NAME}`);

const _get_db_index_text_file = (vector, db_path) => path.resolve(`${db_path}/texts/${vector.toString()}`);