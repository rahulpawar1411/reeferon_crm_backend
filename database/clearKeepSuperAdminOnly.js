/**
 * Clear ALL tables except super_admin (id/email/password kept).
 * Local safety: refuses non-localhost hosts.
 * Usage: node database/clearKeepSuperAdminOnly.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const host = String(process.env.DB_HOST || 'localhost');
  const dbName = process.env.DB_NAME || 'reeferon_crm_db';

  if (host.toLowerCase() !== 'localhost' && host !== '127.0.0.1') {
    console.error(`Refusing: DB_HOST=${host} is not local. Abort.`);
    process.exit(1);
  }

  const pool = await mysql.createPool({
    host,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 2
  });

  const conn = await pool.getConnection();
  try {
    console.log(`Clearing ${host} / ${dbName} — keep only: super_admin`);

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
      if (name === 'super_admin') {
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
