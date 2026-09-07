#!/usr/bin/env node
/**
 * Restore a phpMyAdmin / mysqldump .sql file into the DB from backend/.env
 *
 * Usage:
 *   node scripts/restore-db.js "C:\path\to\backup.sql"
 *   npm run db:restore -- "C:\path\to\backup.sql"
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_BACKUP =
  process.platform === 'win32'
    ? path.join(
        process.env.USERPROFILE || '',
        'Desktop',
        'Backup data',
        'crm',
        '24_08_2026_sql12835558 (2).sql'
      )
    : '';

function cleanSql(raw) {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/CREATE DATABASE[^;]+;/gi, '')
    .replace(/USE `[^`]+`;/gi, '')
    .replace(/SET AUTOCOMMIT = 0;/gi, '')
    .replace(/START TRANSACTION;/gi, '')
    .replace(/COMMIT;/gi, '');
}

async function dropAllTables(conn, dbName) {
  const [tables] = await conn.query('SHOW TABLES');
  if (!tables.length) return;
  const key = `Tables_in_${dbName}`;
  const tableKey = tables[0][key] ? key : Object.keys(tables[0])[0];
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  for (const row of tables) {
    const name = row[tableKey];
    await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
    console.log(`  dropped ${name}`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
}

async function main() {
  const sqlPath = process.argv[2] || DEFAULT_BACKUP;
  if (!sqlPath || !fs.existsSync(sqlPath)) {
    console.error('Backup file not found:', sqlPath || '(none)');
    console.error('Usage: node scripts/restore-db.js "C:\\path\\to\\backup.sql"');
    process.exit(1);
  }

  const dbName = process.env.DB_NAME;
  const host = process.env.DB_HOST || 'localhost';
  console.log(`Restoring ${sqlPath}`);
  console.log(`Target: ${host} / ${dbName}`);

  const sql = cleanSql(fs.readFileSync(sqlPath, 'utf8'));
  const conn = await mysql.createConnection({
    host,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: dbName,
    port: Number(process.env.DB_PORT) || 3306,
    connectTimeout: 60000,
    multipleStatements: true,
  });

  try {
    console.log('Clearing existing tables (if any)...');
    await dropAllTables(conn, dbName);

    console.log('Importing SQL...');
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query('SET NAMES utf8mb4');
    await conn.query(sql);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');

    const counts = [
      'super_admin',
      'sub_admins',
      'customers',
      'do_operators',
      'chambers',
      'daily_chamber_temp_logs',
      'inward_temp_logs',
      'outward_temp_logs',
    ];
    console.log('\nRow counts:');
    for (const t of counts) {
      try {
        const [r] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
        console.log(`  ${t}: ${r[0].c}`);
      } catch (_) {
        console.log(`  ${t}: (missing)`);
      }
    }
    console.log('\nRestore complete.');

    console.log('\nRunning app schema migrations (db.js)...');
    await conn.end();
    await new Promise((resolve, reject) => {
      require('../config/db');
      setTimeout(resolve, 20000);
    });
    console.log('Migrations finished. Restart backend: npm start');
  } catch (err) {
    try {
      await conn.end();
    } catch (_) {}
    throw err;
  }
}

main().catch((err) => {
  console.error('Restore failed:', err.message);
  process.exit(1);
});
