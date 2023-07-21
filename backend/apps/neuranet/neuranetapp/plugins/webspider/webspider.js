/**
 * Can spider a website and ingest all its documents.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const fspromises = require("fs").promises;
const crawler = require(`${__dirname}/crawl.js`);
const spiderconf = require(`${__dirname}/conf/spider.json`);

exports.canHandle = async function(fileindexer) {
    if (fileindexer.filepath.toLowerCase().endsWith(S_PLUGIN_EXTENSION)) {
        const fileContents = await fileindexer.getContents();
        if (JSON.parse(fileContents).url) return true;  // minimally we should have URL we need to crawl
    } else return false;
}

exports.ingest = async function(fileindexer) {
    const fileContents = await fileindexer.getContents(filepath, additionalHandlingInformation);
    let crawlingInstructions; try {crawlingInstructions = JSON.parse(fileContents)} catch (err) {
        LOG.error(`Can't crawl ${fileindexer.filepath} due to JSON parsing error ${err}.`);
        return false;
    }

    const output_folder = path.resolve(`${__dirname}/${spiderconf.crawl_output_root}/${crawler.coredomain(crawlingInstructions.url)}.${Date.now()}`);
    LOG.info(`Starting crawling the URL ${crawlingInstructions.url} to path ${output_folder}.`);
    const crawlResult = await crawler.crawl(crawlingInstructions.url, output_folder, 
        (spiderconf.accepted_mimes||["text/html"]).join(","), spiderconf.timegap||50, 
        spiderconf.max_dispersal||0, spiderconf.max_path||150);
    if (crawlResult) {
        LOG.info(`Site crawl completed for ${crawlingInstructions.url}, ingesting into the AI databases and stores.`);
        return await _ingestFolder(output_folder, fileindexer.id, fileindexer.org, 
            crawlingInstructions.outfolder||`${crawler.coredomain(crawlingInstructions.url)}_${Date.now()}`);
    } else LOG.error(`Crawl of ${crawlingInstructions.url} failed. Nothing was ingested.`);
}

async function _ingestFolder(pathIn, cmsPath) {
    try {
        const filesToIngest = await fspromises.readdir(pathIn, {withFileTypes: true});
        for (const fileEntry of filesToIngest) {
            if (fileEntry.isDirectory()) return _ingestFolder(fileEntry.path); else if (fileEntry.isFile()) {   // ignore anything which is neither a file nor a directory
                const pathThis = path.resolve(fileEntry.path + "/" + fileEntry.name);
                const fileJSON = JSON.parse((await fspromises.readFile(pathThis, "utf8")));
                const cmsPathThisFile = cmsPath+"/"+path.relative(pathIn, pathThis);
                const result = await fileindexer.addFile(Buffer.from(fileJSON.text, 
                    fileJSON.is_binary?"base64":"utf8"), cmsPathThisFile, `URL: ${fileJSON.url}`);
                if ((!result) || (!result.result)) {
                    LOG.error(`AI ingestion of URL ${fileJSON.url} failed.`);
                    return false;
                } else LOG.error(`AI ingestion of URL ${fileJSON.url} to path ${cmsPathThisFile} succeeded.`);
            }
        }
        return true;    // all done
    } catch (err) {
        LOG.error(`Error ingesting folder ${pathIn} for CMS path ${cmsPath} due to error: ${err}.`);
        return false;
    }
}