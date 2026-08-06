/**
 * Clear all operational data; keep super_admin rows only.
 * Usage: npm run db:clear-keep-super-admin
 */
require('dotenv').config();
const db = require('../config/db');

const KEEP_TABLES = new Set(['super_admin']);

async function run() {
  const conn = await db.getConnection();
  try {
    const dbName = process.env.DB_NAME;
    console.log(`Clearing data on ${process.env.DB_HOST} / ${dbName} (keeping: super_admin)…`);

    const [tables] = await conn.query(
      `SELECT TABLE_NAME AS name
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [dbName]
    );

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    let cleared = 0;
    for (const { name } of tables) {
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
    console.log(`Done. Cleared ${cleared} table(s). Super admin left: ${admins.length}`);
    admins.forEach((a) => console.log(`  - ${a.email}`));
  } catch (err) {
    console.error('Clear failed:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    // Pool stays open via db.js; exit explicitly
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
}

run();
