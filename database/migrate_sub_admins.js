/**
 * One-shot migration: create / upgrade sub_admins table for profile + access scope storage.
 * Run: npm run db:migrate-sub-admins  (from backend folder)
 */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function migrateSubAdmins() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'reeferon_crm_db',
    port: Number(process.env.DB_PORT) || 3306,
    multipleStatements: true
  });

  console.log('📦 Connected to MySQL — migrating sub_admins…');

  await connection.query(`
    CREATE TABLE IF NOT EXISTS sub_admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(150) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      full_name VARCHAR(150) DEFAULT NULL,
      phone_no VARCHAR(20) DEFAULT NULL,
      allowed_clients TEXT DEFAULT NULL COMMENT 'Comma-separated client names from DO logs',
      allowed_warehouses TEXT DEFAULT NULL COMMENT 'Comma-separated warehouse names',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [columns] = await connection.query('SHOW COLUMNS FROM sub_admins');
  const colNames = columns.map((c) => c.Field);

  const alters = [
    { name: 'full_name', sql: 'ALTER TABLE sub_admins ADD COLUMN full_name VARCHAR(150) DEFAULT NULL' },
    { name: 'phone_no', sql: 'ALTER TABLE sub_admins ADD COLUMN phone_no VARCHAR(20) DEFAULT NULL' },
    { name: 'allowed_clients', sql: 'ALTER TABLE sub_admins ADD COLUMN allowed_clients TEXT DEFAULT NULL' },
    { name: 'allowed_warehouses', sql: 'ALTER TABLE sub_admins ADD COLUMN allowed_warehouses TEXT DEFAULT NULL' },
    { name: 'updated_at', sql: 'ALTER TABLE sub_admins ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' }
  ];

  for (const { name, sql } of alters) {
    if (!colNames.includes(name)) {
      await connection.query(sql);
      console.log(`  ➕ Added column: ${name}`);
    } else {
      console.log(`  ✓ Column exists: ${name}`);
    }
  }

  const [finalCols] = await connection.query('SHOW COLUMNS FROM sub_admins');
  console.log('\n✅ sub_admins ready. Columns:', finalCols.map((c) => c.Field).join(', '));

  await connection.end();
}

migrateSubAdmins()
  .then(() => {
    console.log('🎉 Migration completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  });
