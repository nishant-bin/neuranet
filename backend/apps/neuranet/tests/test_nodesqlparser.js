if (require.main === module) {
    if (process.argv.length < 3) {console.error("Usage: nodeSQLParser <sql statement> [parser_to_use]"); process.exit(1);}
    
    const parser_to_use = process.argv[3]?.toLowerCase() || "nodesql";
    if (parser_to_use == "nodesql") node_sql_parse(process.argv[2]);
    else if (parser_to_use == "jssql") js_sql_parse(process.argv[2]);
    else if (parser_to_use == "flora") node_sql_parse(process.argv[2], true);
    else if (parser_to_use == "nodesqlparser") js_sql_parse(process.argv[2], true);
    else node_sql_parse(process.argv[2]);
}

function node_sql_parse(sql, useflora) {
    const { Parser } = useflora?require('@florajs/sql-parser'):require('node-sql-parser');
    const parser = new Parser();
    try {
        const ast = parser.astify(sql);
        console.log(ast); 
        process.exit(0);
    } catch (err) {
        console.log("Bad SQL!"); 
        console.log(`${err.name}: ${err.message}\nFound at: Line:${err.location.start.line}, Column:${err.location.start.column}`); 
        process.exit(1);
    }
}

function js_sql_parse(sql, usenodesqlparser) {
    const parser = usenodesqlparser?require('node-sqlparser'):require('js-sql-parser');
    try {
        const ast = parser.parse(sql);
        console.log(ast); 
        process.exit(0);
    } catch (err) {
        console.log("Bad SQL!"); 
        process.exit(1);
    }
}
