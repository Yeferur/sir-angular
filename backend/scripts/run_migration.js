const db = require('../database/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        const migrationsDir = path.join(__dirname, '../database/migrations');
        const migrationFiles = fs.existsSync(migrationsDir)
            ? fs.readdirSync(migrationsDir).filter((file) => file.toLowerCase().endsWith('.sql')).sort()
            : [];

        if (!migrationFiles.length) {
            console.log('No SQL migrations found.');
            process.exit(0);
        }

        for (const migrationFile of migrationFiles) {
            const sqlPath = path.join(migrationsDir, migrationFile);
            const sql = fs.readFileSync(sqlPath, 'utf8');

            const statements = sql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            console.log(`Running migration ${migrationFile} with ${statements.length} SQL statements.`);

            for (const statement of statements) {
                await db.query(statement);
                console.log('Executed statement.');
            }
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

runMigration();
