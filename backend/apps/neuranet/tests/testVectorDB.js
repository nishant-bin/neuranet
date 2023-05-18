/**
 * Tests the vector DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);
const aivectordb_test_path = `${__dirname}/vector_db/test`;

exports.runTestsAsync = async function(argv) {
    LOG.console(`Test case for VectorDB called.\n`);
    const vectorDB = await aivectordb.get_vectordb(aivectordb_test_path);
    LOG.console(JSON.stringify(vectorDB)+"\n");
}
