/** 
 * SQL validator.
 * 
 * DB can be
 * ansi, db2, mysql, oracle, postgressql, mssql
 * 
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */
const {exec} = require("child_process");
const fspromises = require("fs").promises;
const sqlparser = require("node-sql-parser");
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/sqlvalidator.json`);

const VALIDATOR_EXEC = conf.VALIDATOR_EXEC+(process.platform == "win32"?".exe":"");
const VALIDATOR_RE = new RegExp(conf.VALIDATOR_RE, conf.VALIDATOR_RE_OPTIONS);
const SQL_PARSER = new sqlparser.Parser();

exports.validate = async function(sql, db, encoding, simple) {
    if (simple) return _simpleValidate(sql);

    const dbdialect = conf.VALIDATOR_DIALECT_MAPPING[db]||conf.VALIDATOR_DIALECT_MAPPING.default;
    const tmpFile = utils.getTempFile("sql", NEURANET_CONSTANTS.TEMPDIR, "validator.");

    const validatorCmd = conf.VALIDATOR_CMD.replace("__FILE__", tmpFile).replace("__DIALECT__" , dbdialect), 
        execCmd = `${NEURANET_CONSTANTS.THIRDPARTYDIR}/${VALIDATOR_EXEC} ${validatorCmd}`;
    await fspromises.writeFile(tmpFile, sql, encoding||"utf8");
    let validationResult; try {validationResult = await _os_cmd(execCmd);} catch (err) {validationResult = err};
    fspromises.unlink(tmpFile);

    if ((!validationResult) || validationResult.error || (validationResult.stderr.trim() != "") || (
            validationResult.exitcode != 0)) {
        LOG.debug(`Validation for SQL ${sql} failed, due to exec error${validationResult?" "+validationResult.error:""}.`);
        return {isOK: false, errors: validationResult.console.trim() != ""?_getParserErrors(validationResult.console):[]}
    } else return {isOK: true};
}

function _simpleValidate(sql, skipValidation) { 
	if (skipValidation) return {isOK: true};
	try { SQL_PARSER.parse(sql); return {isOK: true}; } catch (err) { 
		if (sql.match(/create[' '\t]+procedure/i) || sql.match(/create[' '\t]+table/i)) return {isOK: true};	// the parser grammar doesn't support create statements
		return {isOK: false, errors: [{line: err.location.start.line, column: err.location.start.column, 
            error: `${err.name}: ${err.message}`}]};
	}
}

function _os_cmd(cmd, environment) {
    let processExitCode = -1;
    return new Promise((resolve, reject) => {
        exec(cmd, {maxBuffer: CONSTANTS.MAX_STDIO_BUFFER, encoding : "binary", env: environment}, 
                (error, data, stderr) => {
            
            LOG.info(`Executing OS process ${cmd}`);

            if (error) reject({error, console: data, stderr, exitcode: processExitCode});
            else resolve({error: null, console: data, stderr, exitcode: processExitCode});
        }).on("exit", exitCode => processExitCode = exitCode);
    });
}

function _getParserErrors(output) {
    let match, errors = [];
    do { match = VALIDATOR_RE.exec(output); 
        if (match) errors.push({line: match[1], column: match[2], error: match[3]}); else break; } while(match);
    return errors;
}