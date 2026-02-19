const db = require('../backend/database/db');

async function migrate() {
    try {
        console.log('Adding Es_Denegado column to usuario_permisos...');
        const [result] = await db.query(`
            ALTER TABLE usuario_permisos 
            ADD COLUMN Es_Denegado TINYINT(1) DEFAULT 0;
        `);
        console.log('Migration successful:', result);
    } catch (error) {
        if (error.code === 'ER_DUP_FIELDNAME') {
            console.log('Column Es_Denegado already exists.');
        } else {
            console.error('Migration failed:', error);
        }
    } finally {
        process.exit();
    }
}

migrate();
