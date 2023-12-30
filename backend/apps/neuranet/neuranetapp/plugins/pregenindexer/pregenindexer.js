/**
 * Indexes the given document as a pre-gen flow (GARAGe) 
 * apporach.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const yaml = require("yaml");
const fspromises = require("fs").promises;
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

exports.canHandle = async function(fileindexer) {
    if (await _isOrgEnabledForPregen(fileindexer.org)) return true;   // we can handle all files if enabled
    else return false;
}

exports.ingest = async function(fileindexer) {
    const pregenSteps = _getPregenStepsForOrg(fileindexer.id, fileindexer.org);
    for (const pregenStep of pregenSteps) {
        const pregenResult = await pregenStep(fileindexer);
        if (pregenResult.result) fileindexer.addFile(pregenResult.contentOrReadStream(), 
            pregenResult.cmspath, pregenResult.lang, pregenResult.comment, false, false);
        else LOG.error(`Pregen failed `)
    }
}

async function _getPregenStepsForOrg(id, org) {
    const generator_id = brainhandler.getActiveBrainIDForUser(id, org);
    const pregenStepObjects = yaml.parse(await fspromises.readFile(`${NEURANET_CONSTANTS.ORGDIR}/${org}/pregensteps_${generator_id}.yaml`, "utf8"));
    const pregenFunctions = []; for (const pregenStepObject of pregenStepObjects) {
        const aiModelObjectThisStep = await aiutils.getAIModel(pregenStepObject.model);
        pregenFunctions.push(async fileindexer => await NEURANET_CONSTANTS.getPlugin(pregenStepObject.command).generate(
            fileindexer, pregenStepObject.prompt, aiModelObjectThisStep, pregenStepObject.pathid));
    }
        
    return pregenFunctions;
}

async function _isOrgEnabledForPregen(org) {
    const settings = await dblayer.getOrgSettings(org);
    return settings.pregen;
}