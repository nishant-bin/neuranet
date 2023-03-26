if (require.main === module) {
    if (process.argv.length < 2) {console.err("Usage: nodeSQLParser <sql statement>"); process.exit(1);}
    const { Parser } = require('node-sql-parser');
    const parser = new Parser();
    // opt is optional
    try {
        const {ast} = parser.parse(process.argv[2]);
        console.log(ast); 
        process.exit(0);
    } catch (err) {console.log("Bad SQL!"); console.log(`${err.name}: ${err.message}\nFound at: Line:${err.location.start.line}, Column:${err.location.start.column}`); process.exit(1);}
}