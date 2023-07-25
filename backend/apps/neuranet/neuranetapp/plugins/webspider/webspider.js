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

const PLUGIN_EXTENSION = ".crawl";
const DEFAULT_MIMES = {"text/html":{ending:".html"}, "application/pdf":{ending:".pdf"}};

exports.canHandle = async function(fileindexer) {
    if (fileindexer.filepath.toLowerCase().endsWith(PLUGIN_EXTENSION)) {
        const fileContents = await fileindexer.getContents();
        if (JSON.parse(fileContents).url) return true;  // minimally we should have URL we need to crawl
    } else return false;
}

exports.ingest = async function(fileindexer) {
    const fileContents = await fileindexer.getContents();
    let crawlingInstructions; try {crawlingInstructions = JSON.parse(fileContents)} catch (err) {
        LOG.error(`Can't crawl ${fileindexer.filepath} due to JSON parsing error ${err}.`);
        return false;
    }

    /*
    const output_folder = path.resolve(`${__dirname}/${spiderconf.crawl_output_root}/${crawler.coredomain(crawlingInstructions.url)}.${Date.now()}`);
    LOG.info(`Starting crawling the URL ${crawlingInstructions.url} to path ${output_folder}.`);
    const crawlResult = await crawler.crawl(crawlingInstructions.url, output_folder, 
        spiderconf.accepted_mimes||DEFAULT_MIMES, spiderconf.timegap||50, spiderconf.max_dispersal||0, 
        spiderconf.max_path||150);*/
    const output_folder = path.resolve(`${__dirname}/${spiderconf.crawl_output_root}/${crawler.coredomain(crawlingInstructions.url)}.${'1690182353593'}`),
        crawlResult = true; // for testing only
    if (crawlResult) {
        LOG.info(`Site crawl completed for ${crawlingInstructions.url}, ingesting into the AI databases and stores.`);
        return await _ingestFolder(output_folder, 
            crawlingInstructions.outfolder||`${crawler.coredomain(crawlingInstructions.url)}_${Date.now()}`,
            fileindexer);
    } else LOG.error(`Crawl of ${crawlingInstructions.url} failed. Nothing was ingested.`);
}

async function _ingestFolder(pathIn, cmsPath, fileindexer, rootPathIn) {
    try {
        const direntries = await fspromises.readdir(pathIn, {withFileTypes: true});
        for (const direntry of direntries) {
            const pathThisEntry = path.resolve(pathIn + "/" + direntry.name);
            const cmsPathThisEntry = cmsPath+"/"+path.relative(pathIn, pathThisEntry);

            if (direntry.isDirectory()) return await _ingestFolder(pathThisEntry, cmsPathThisEntry, fileindexer, rootPathIn||pathIn); 
            else if (direntry.isFile()) {   // ignore anything which is neither a file nor a directory
                const fileJSON = JSON.parse((await fspromises.readFile(pathThisEntry, "utf8")));
                const result = await fileindexer.addFile(Buffer.from(fileJSON.text, 
                    fileJSON.is_binary?"base64":"utf8"), cmsPathThisEntry, `URL: ${fileJSON.url}`);
                if ((!result) || (!result.result)) {
                    LOG.error(`AI ingestion of URL ${fileJSON.url} failed.`);
                    return false;
                } else LOG.info(`AI ingestion of URL ${fileJSON.url} to path ${cmsPathThisEntry} succeeded.`);
            }
        }
        return true;    // all done
    } catch (err) {
        LOG.error(`Error ingesting folder ${pathIn} for CMS path ${cmsPath} due to error: ${err}.`);
        return false;
    }
}