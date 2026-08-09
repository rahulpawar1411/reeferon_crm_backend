/**
 * One-shot migration: create / upgrade customers table (renames legacy sub_admins if needed).
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

  console.log('📦 Connected to MySQL — migrating customers…');

  const [tables] = await connection.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sub_admins', 'customers')`
  );
  const names = new Set(tables.map((t) => t.name));
  if (names.has('sub_admins') && !names.has('customers')) {
    await connection.query('RENAME TABLE sub_admins TO customers');
    console.log('  ↪ Renamed sub_admins → customers');
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(150) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      full_name VARCHAR(150) DEFAULT NULL,
      phone_no VARCHAR(20) DEFAULT NULL,
      allowed_clients TEXT DEFAULT NULL COMMENT 'Comma-separated client names from DO logs',
      allowed_warehouses TEXT DEFAULT NULL COMMENT 'Comma-separated warehouse names',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [columns] = await connection.query('SHOW COLUMNS FROM customers');
  const colNames = columns.map((c) => c.Field);

  const alters = [
    { name: 'full_name', sql: 'ALTER TABLE customers ADD COLUMN full_name VARCHAR(150) DEFAULT NULL' },
    { name: 'phone_no', sql: 'ALTER TABLE customers ADD COLUMN phone_no VARCHAR(20) DEFAULT NULL' },
    { name: 'allowed_clients', sql: 'ALTER TABLE customers ADD COLUMN allowed_clients TEXT DEFAULT NULL' },
    { name: 'allowed_warehouses', sql: 'ALTER TABLE customers ADD COLUMN allowed_warehouses TEXT DEFAULT NULL' },
    { name: 'updated_at', sql: 'ALTER TABLE customers ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL' }
  ];

  for (const { name, sql } of alters) {
    if (!colNames.includes(name)) {
      await connection.query(sql);
      console.log(`  ➕ Added column: ${name}`);
    } else {
      console.log(`  ✓ Column exists: ${name}`);
    }
  }

  try {
    const [upd] = await connection.query(
      "UPDATE login_security SET role = 'customer' WHERE role = 'sub_admin'"
    );
    if (upd?.affectedRows > 0) {
      console.log(`  ↪ login_security: ${upd.affectedRows} role(s) sub_admin → customer`);
    }
  } catch (_) {
    /* login_security may not exist */
  }

  const [finalCols] = await connection.query('SHOW COLUMNS FROM customers');
  console.log('\n✅ customers ready. Columns:', finalCols.map((c) => c.Field).join(', '));

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
