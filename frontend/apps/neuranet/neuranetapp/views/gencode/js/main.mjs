/** 
 * View main module for the gencode view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {gencode} from "./gencode.mjs";

async function initView(data, main) {await gencode.init(data, main);}

export const main = {initView};