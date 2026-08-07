/**
 * Clear all operational data; keep super_admin rows only (id + password untouched).
 * Usage: npm run db:clear-keep-super-admin
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const KEEP_TABLES = new Set(['super_admin']);

async function run() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'reeferon_crm_db',
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 2
  });

  const conn = await pool.getConnection();
  try {
    const dbName = process.env.DB_NAME || 'reeferon_crm_db';
    console.log(`Clearing data on ${process.env.DB_HOST} / ${dbName} (keeping: super_admin)…`);

    const [tables] = await conn.query(
      `SELECT TABLE_NAME AS name
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [dbName]
    );

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    let cleared = 0;
    for (const row of tables) {
      const name = row.name || row.TABLE_NAME;
      if (KEEP_TABLES.has(name)) {
        console.log(`  keep  ${name}`);
        continue;
      }
      await conn.query(`TRUNCATE TABLE \`${name}\``);
      console.log(`  clear ${name}`);
      cleared += 1;
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    const [admins] = await conn.query('SELECT id, email FROM super_admin');
    console.log(`Done. Cleared ${cleared} table(s). Super Admin kept:`);
    if (!admins.length) {
      console.log('  (none — table empty)');
    } else {
      admins.forEach((a) => console.log(`  #${a.id} ${a.email}`));
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Clear failed:', err.message);
  process.exit(1);
});
