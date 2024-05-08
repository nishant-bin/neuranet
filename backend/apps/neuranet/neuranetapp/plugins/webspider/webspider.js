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
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;

const PLUGIN_EXTENSION = ".crawl", DEFAULT_MINIMUM_SUCCESS_PERCENT = 0.5;
const DEFAULT_MIMES = {"text/html":{ending:".html"}, "application/pdf":{ending:".pdf"}};

exports.canHandle = async function(fileindexer) {
    if (fileindexer.filepath.toLowerCase().endsWith(PLUGIN_EXTENSION)) {
        const fileContents = await fileindexer.getContents(); if (!fileContents) return false;
        let crawlInstructions; try { crawlInstructions = JSON.parse(fileContents); } catch (err) { return false; }
        if (_normalizePath(fileindexer.cmspath.toLowerCase()) == 
            _normalizePath(crawlInstructions.outfolder.toLowerCase())) throw new Error(
                `File paths clash ${fileindexer.cmspath} is same as output folder.`, {cause: "PATH_CLASH"});
        if (crawlInstructions.url) return true;  // minimally we should have URL we need to crawl
    } else return false;
}

exports.ingest = async function(fileindexer) {
    const fileContents = await fileindexer.getContents(); if (!fileContents) {LOG.error(`Content extraction failed for ${fileindexer.filepath}.`); return false;}
    let crawlingInstructions; try {crawlingInstructions = JSON.parse(fileContents)} catch (err) {
        LOG.error(`Can't crawl ${fileindexer.filepath} due to JSON parsing error ${err}.`);
        return false;
    }
    if (!Array.isArray(crawlingInstructions)) crawlingInstructions = [crawlingInstructions];

    let allCrawlsResult = true;
    for (const crawlingInstructionsThis of crawlingInstructions) {
        const output_folder = path.resolve(`${__dirname}/${spiderconf.crawl_output_root}/${
            spiderconf.dont_crawl ? spiderconf.ingestion_folder : crawler.coredomain(crawlingInstructionsThis.url)+"."+Date.now()}`);
        // first crawl to download all the files, this doesn't add anything to the CMS or AI DBs
        const crawlResult = await _crawlWebsite(crawlingInstructionsThis, output_folder);
        if (spiderconf.dont_ingest) continue;    // only testing crawling

        if (crawlResult) LOG.info(`Site crawl completed for ${crawlingInstructionsThis.url}, starting ingestion into the AI databases and stores.`);
        else {LOG.info(`Site crawl failed for ${crawlingInstructionsThis.url}, not ingesting into the AI databases and stores.`); allCrawlsResult = false; continue;}
        
        // now that the download succeeded, ingest into Neuranet databases
        const ingestResult = await _ingestCrawledFilesIntoNeuranet(crawlingInstructionsThis, fileindexer, output_folder);
        if (ingestResult) LOG.info(`Site AI database ingestion completed for ${crawlingInstructionsThis.url}.`);
        else {LOG.info(`Site AI database ingestion failed for ${crawlingInstructionsThis.url}`); allCrawlsResult = false;}
    }
    return allCrawlsResult;
}

async function _crawlWebsite(crawlingInstructionsThis, output_folder) {
    LOG.info(`Starting crawling the URL ${crawlingInstructionsThis.url} to path ${output_folder}.`);
    const crawlResult = spiderconf.dont_crawl ? true : await crawler.crawl(crawlingInstructionsThis.url, output_folder, 
        spiderconf.accepted_mimes||DEFAULT_MIMES, spiderconf.timegap||50, 
        crawlingInstructionsThis.host_dispersal_depth||spiderconf.default_host_dispersal_depth||0,
        crawlingInstructionsThis.page_dispersal_depth||spiderconf.default_page_dispersal_depth||-1, 
        crawlingInstructionsThis.restrict_host, spiderconf.max_path||150);
    if (!crawlResult) _logCrawlError(crawlingInstructionsThis.url); 
    else LOG.info(`Crawl of ${crawlingInstructionsThis.url} completed successfully.`);

    return crawlResult;
}

async function _ingestCrawledFilesIntoNeuranet(crawlingInstructionsThis, fileindexer, output_folder) {
    let finalResult = true; fileindexer.start();
    const ingestionResult = await _ingestFolder(output_folder, 
        crawlingInstructionsThis.outfolder||`${crawler.coredomain(crawlingInstructionsThis.url)}_${Date.now()}`,
        fileindexer);
    if (!await fileindexer.end()) {_logCrawlError(crawlingInstructionsThis.url); finalResult = false;}  // rebuild AI DBs etc.
    const percentSuccess = ingestionResult.result?ingestionResult.successfully_ingested.length/
        (ingestionResult.successfully_ingested.length+ingestionResult.failed_ingestion.length):0;
    const thisCrawlResult = ingestionResult.result && ingestionResult.successfully_ingested != 0 && percentSuccess > 
        (fileindexer.minimum_success_percent||DEFAULT_MINIMUM_SUCCESS_PERCENT);
    if (!thisCrawlResult) {
        LOG.error(`Ingestion of ${crawlingInstructionsThis.url} failed. Folder ingestion into AI databases failed, partial ingestion may have occured requiring database cleanup.`);
        finalResult = false;
    } else LOG.info(`Ingestion of ${crawlingInstructionsThis.url} succeeded. Folder ingestion into AI databases completed.`);
    if (ingestionResult.result) LOG.debug(`List of successfully ingested files: ${ingestionResult.successfully_ingested.toString()}`);
    if (ingestionResult.result) LOG.debug(`List of failed to ingest files: ${ingestionResult.failed_ingestion.toString()}`);
    return finalResult;
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
                const result = await _promiseExceptionToBoolean(fileindexer.addFileToCMSRepository(Buffer.from(fileJSON.text, 
                    fileJSON.is_binary?"base64":"utf8"), cmsPathThisEntry));   

                if(!result) {
                    LOG.error(`AI ingestion of URL ${fileJSON.url} failed.`); 
                }

                const _areCMSPathsSame = (cmspath1, cmspath2) => 
		            (utils.convertToUnixPathEndings("/"+cmspath1, true) == utils.convertToUnixPathEndings("/"+cmspath2, true));

                const aidbFileProcessedPromise = new Promise(resolve => blackboard.subscribe(
                    NEURANET_CONSTANTS.NEURANETEVENT, function(message) { 
                        if (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED && 
                            _areCMSPathsSame(message.cmspath, cmsPathThisEntry)) {
                        blackboard.unsubscribe(NEURANET_CONSTANTS.NEURANETEVENT, this); resolve(message); }
                    }
                ));
                
                const aidbIngestionResult = await aidbFileProcessedPromise;
                if ((!aidbIngestionResult) || (!aidbIngestionResult.result)) {
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

const _logCrawlError = url => LOG.error(`Site crawl of ${url} failed. Nothing was ingested from this site.`);

const _promiseExceptionToBoolean = async promise => {try{const result = await promise; return result||true;} catch(err) {return false;}}

const _normalizePath = pathIn => pathIn.replace(/^\/+/g,"").replace(/\/+/g,"/");
