/**
 * Quota calculations.
 * (C) 2022 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */

const register = require(`${LOGINAPP_CONSTANTS.API_DIR}/register.js`);
const NEURANET_CONSTANTS = LOGINAPP_CONSTANTS.ENV.NEURANETAPP_CONSTANTS;
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

exports.checkQuota = async function(id) {
    let allowedQuota = await dblayer.getQuota(id);
    if (allowedQuota == -1) allowedQuota = await dblayer.getQuota(register.getRootDomain({id}));
    if (allowedQuota == -1) allowedQuota = await dblayer.getQuota(NEURANET_CONSTANTS.CONF.quota_default_org);
    if (allowedQuota == -1) {LOG.warn(`No quota found for ID ${id}, not checking or enforcing.`); return true;}

    LOG.info(`Found that ID ${id} is allowed a quota price equal to ${allowedQuota}.`);

    const models = Object.keys(NEURANET_CONSTANTS.CONF.ai_models), 
        unixepochNow = Math.floor(new Date().getTime() / 1000), SECONDS_IN_24_HOURS = 86400;
    let totalUsedIn24Hours = 0; for (const model of models) {
        const modelUsage = await dblayer.getAIModelUsage(id, unixepochNow - SECONDS_IN_24_HOURS, unixepochNow, model),
            priceOfUsageThisModel = modelUsage * NEURANET_CONSTANTS.CONF.ai_models[model].price_per_unit;
        totalUsedIn24Hours += priceOfUsageThisModel;
        LOG.info(`ID ${id} used ${modelUsage} units of model ${model} in the last 24 hours, which equates to a price of ${priceOfUsageThisModel}.`);
    }

    if (totalUsedIn24Hours > allowedQuota) {
        LOG.error(`Quota overuse for ID ${id}, allowed = ${allowedQuota}, used = ${totalUsedIn24Hours}.`);
        return false; 
    } else {
        LOG.info(`Quota use for ID ${id}, allowed = ${allowedQuota}, used = ${totalUsedIn24Hours}.`);
        return true;
    }
}