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

const PLUGIN_EXTENSION = ".crawl", DEFAULT_MINIMUM_SUCCESS_PERCENT = 0.5;
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
    if (!Array.isArray(crawlingInstructions)) crawlingInstructions = [crawlingInstructions];

    const _logCrawlError = url => LOG.error(`Site crawl of ${url} failed. Nothing was ingested from this site.`);

    let allCrawlsResult = true;
    for (const crawlingInstructionsThis of crawlingInstructions) {
        const output_folder = path.resolve(`${__dirname}/${spiderconf.crawl_output_root}/${crawler.coredomain(crawlingInstructionsThis.url)}.${"1690906094137"/*Date.now()*/}`);
        LOG.info(`Starting crawling the URL ${crawlingInstructionsThis.url} to path ${output_folder}.`);
        const crawlResult = await crawler.crawl(crawlingInstructionsThis.url, output_folder, 
            spiderconf.accepted_mimes||DEFAULT_MIMES, spiderconf.timegap||50, 
            crawlingInstructionsThis.host_dispersal_depth||spiderconf.default_host_dispersal_depth||0,
            crawlingInstructionsThis.page_dispersal_depth||spiderconf.default_page_dispersal_depth||-1, 
            spiderconf.max_path||150);
        if (crawlResult) {
            LOG.info(`Site crawl completed for ${crawlingInstructionsThis.url}, ingesting into the AI databases and stores.`);
            fileindexer.start();
            const ingestionResult = await _ingestFolder(output_folder, 
                crawlingInstructionsThis.outfolder||`${crawler.coredomain(crawlingInstructionsThis.url)}_${Date.now()}`,
                fileindexer);
            if (!await fileindexer.end()) {_logCrawlError(crawlingInstructionsThis.url); allCrawlsResult = false;}  // rebuild AI DBs etc.
            const percentSuccess = ingestionResult.result?ingestionResult.successfully_ingested.length/
                (ingestionResult.successfully_ingested.length+ingestionResult.failed_ingestion.length):0;
            const thisCrawlResult = ingestionResult.result && ingestionResult.successfully_ingested != 0 && percentSuccess > 
                (fileindexer.minimum_success_percent||DEFAULT_MINIMUM_SUCCESS_PERCENT);
            if (!thisCrawlResult) {
                LOG.error(`Ingestion of ${crawlingInstructionsThis.url} failed. Folder ingestion into AI databases failed, partial ingestion may have occured requiring database cleanup.`);
                allCrawlsResult = false;
            } else LOG.info(`Ingestion of ${crawlingInstructionsThis.url} succeeded. Folder ingestion into AI databases completed.`);
            if (ingestionResult.result) LOG.debug(`List of successfully ingested files: ${ingestionResult.successfully_ingested.toString()}`);
            if (ingestionResult.result) LOG.debug(`List of failed to ingest files: ${ingestionResult.failed_ingestion.toString()}`);
        } else {_logCrawlError(crawlingInstructionsThis.url); allCrawlsResult = false;}
    }
    return allCrawlsResult;
}

async function _ingestFolder(pathIn, cmsPath, fileindexer, memory) {
    try {
        const direntries = await fspromises.readdir(pathIn, {withFileTypes: true});
        for (const direntry of direntries) {
            const pathThisEntry = path.resolve(pathIn + "/" + direntry.name);
            const cmsPathThisEntry = cmsPath+"/"+path.relative(pathIn, pathThisEntry);

            if (direntry.isDirectory()) return await _ingestFolder(pathThisEntry, cmsPathThisEntry, 
                fileindexer, memory||{roootpath: pathIn, successfully_ingested: [], failed_ingestion: []}); 
            else if (direntry.isFile()) {   // ignore anything which is neither a file nor a directory
                LOG.info(`Starting to AI ingest ${pathThisEntry}`)
                let fileJSON; try {fileJSON = JSON.parse((await fspromises.readFile(pathThisEntry, "utf8")));}
                catch (err) {
                    memory.failed_ingestion.push(pathThisEntry); 
                    LOG.error(`Error ingesting file ${pathThisEntry} for CMS path ${cmsPathThisEntry} due to error: ${err}.`);
                    continue;
                }
                const result = await fileindexer.addFile(Buffer.from(fileJSON.text, 
                    fileJSON.is_binary?"base64":"utf8"), cmsPathThisEntry, `URL: ${fileJSON.url}`, false);   // don't rebuild DBs
                if ((!result) || (!result.result)) {
                    memory.failed_ingestion.push(pathThisEntry); 
                    LOG.error(`AI ingestion of URL ${fileJSON.url} failed.`); 
                } else {
                    memory.successfully_ingested.push(pathThisEntry);
                    LOG.info(`AI ingestion of URL ${fileJSON.url} to path ${cmsPathThisEntry} succeeded.`);
                }
            }
        }
        return {result: true, successfully_ingested: memory?memory.successfully_ingested:undefined, 
            failed_ingestion: memory?memory.failed_ingestion:undefined};    // all done
    } catch (err) {
        LOG.error(`Error ingesting folder ${pathIn} for CMS path ${cmsPath} due to error: ${err}.`);
        return {result: false, successfully_ingested: memory?memory.successfully_ingested:undefined, 
            failed_ingestion: memory?memory.failed_ingestion:undefined}; 
    }
}