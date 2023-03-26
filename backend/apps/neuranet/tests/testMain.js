/**
 * Test suite entry file.
 */

require(`${__dirname}/../lib/app.js`).initSync();
const LOG = console;

exports.testMain = function(_argv) { // xforge entry point for Monkshu test runs.
    LOG.info("Running tests");
}

if (require.main === module) exports.testMain(process.argv);