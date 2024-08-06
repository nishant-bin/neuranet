/**
 * Tests the custom testcases mention in the custom_configurtion.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */
const fs = require('fs');
const customfile = "custom.json";
const GEN_REPORT_PREFIX = "output";
const customTestcases = JSON.parse(fs.readFileSync(`${__dirname}/conf/${customfile}`)).testcases;

exports.runTestsAsync = async function(argv) {
	if ((!argv[0]) || (argv[0].toLowerCase() != "custom")) {
		LOG.console(`Skipping custom test case, not called.\n`);
		return;
	}

	LOG.console("------------------Custom Test Case--------------------\n");
	
	let testResults = []; for (const [i, testcase] of customTestcases.entries()) {
		LOG.console(`----------Case:${i+1}--------\n`);
		let resultCount = 0, testNames = Object.keys(testcase);
		for (let testName of testNames) {
			if(typeof testcase[testName] !== 'object') continue;
			try {
				const testNameWithoutIndex = testName.split('_').slice(0,-1).join("_");
				testcase[testName].unshift(testName);
				const module = require(`${__dirname}/${_getModuleName( testNameWithoutIndex || testName)}`);
				testcase[testName][0] = testNameWithoutIndex ?  testNameWithoutIndex : testName
				const result = await module.runTestsAsync(testcase[testName]);
				if(result) resultCount++; }
			catch(err){ LOG.console(`${testName} Failed, error:${err.message}\n`); }	
		}
		testResults.push(resultCount===testNames.length-1);
	}

	const genDirName = argv[2], genFileName = argv[1];
    _generateCSVReport(genDirName, genFileName, testResults);
	LOG.console("-------------------------------------------------------\n");
	return true;
}

const _getModuleName = (testName) => `test_${testName}.js`;

const _generateCSVReport = (genDirName, genFileName, results) => {
	try{
		const csvHeades = `S.no, Test Case, Status\n`; // csv Formate : S.no | Test case | Status
		let csvRows = []; for (const [i, testcase] of customTestcases.entries()) {
			csvRows.push(`${i+1}, ${_escapeCommas(testcase["testDescription"]||"")}, ${results[i]}`); }
		const csvData = csvHeades + csvRows.join('\n');
		const  dirName = genDirName || __dirname, fileName = genFileName || `${GEN_REPORT_PREFIX}_${Date.now()}.csv`;
		fs.writeFileSync(`${dirName}/${fileName}`, csvData); LOG.console(`**Report Generated**\n`);
	} catch(err) { LOG.console(`**Report Generation Failed**\n${err}\nResults: ${results}\n`); }
}

const _escapeCommas = (value) => `"${value.replace(/"/g, '""')}"`;
