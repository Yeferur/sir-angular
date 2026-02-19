const db = require('../database/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '../database/migrations/create_auth_tables.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Split statements by semicolon (simple split, assumes valid SQL for this case)
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute.`);

        for (const statement of statements) {
            await db.query(statement);
            console.log('Executed statement.');
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
