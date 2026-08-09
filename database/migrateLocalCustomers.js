/**
 * Migrate LOCALHOST MySQL only: sub_admins → customers
 * Does NOT use FreeSQL / DATABASE_URL from .env
 *
 * Run from backend folder:
 *   node database/migrateLocalCustomers.js
 *
 * Optional env overrides:
 *   LOCAL_DB_HOST=127.0.0.1 LOCAL_DB_USER=root LOCAL_DB_PASSWORD= LOCAL_DB_NAME=reeferon_crm_db
 */
const mysql = require('mysql2/promise');

async function main() {
  const host = process.env.LOCAL_DB_HOST || '127.0.0.1';
  const user = process.env.LOCAL_DB_USER || 'root';
  const password = process.env.LOCAL_DB_PASSWORD || '';
  const database = process.env.LOCAL_DB_NAME || 'reeferon_crm_db';
  const port = Number(process.env.LOCAL_DB_PORT || 3306);

  console.log(`Connecting to LOCAL ${host}:${port} / ${database} ...`);
  const conn = await mysql.createConnection({ host, user, password, database, port });

  const [tables] = await conn.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sub_admins', 'customers')`
  );
  const names = new Set(tables.map((t) => t.name));
  console.log('Before:', {
    customers: names.has('customers'),
    sub_admins: names.has('sub_admins')
  });

  if (names.has('sub_admins') && !names.has('customers')) {
    await conn.query('RENAME TABLE sub_admins TO customers');
    console.log('Renamed sub_admins → customers');
    names.delete('sub_admins');
    names.add('customers');
  }

  if (names.has('sub_admins') && names.has('customers')) {
    const preferred = [
      'id',
      'email',
      'password',
      'full_name',
      'phone_no',
      'allowed_clients',
      'allowed_warehouses',
      'created_at',
      'updated_at'
    ];
    const [custCols] = await conn.query('SHOW COLUMNS FROM customers');
    const [subCols] = await conn.query('SHOW COLUMNS FROM sub_admins');
    const custSet = new Set(custCols.map((c) => c.Field));
    const subSet = new Set(subCols.map((c) => c.Field));
    const shared = preferred.filter((c) => custSet.has(c) && subSet.has(c));
    if (shared.length) {
      const colList = shared.join(', ');
      const [ins] = await conn.query(
        `INSERT IGNORE INTO customers (${colList}) SELECT ${colList} FROM sub_admins`
      );
      console.log(`Merged rows into customers: ${ins?.affectedRows ?? 0}`);
    }
    await conn.query('DROP TABLE sub_admins');
    console.log('Dropped sub_admins');
    names.delete('sub_admins');
  }

  if (!names.has('customers')) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(150) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(150) DEFAULT NULL,
        phone_no VARCHAR(20) DEFAULT NULL,
        allowed_clients TEXT DEFAULT NULL,
        allowed_warehouses TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT NULL
      )
    `);
    console.log('Created empty customers table');
  }

  try {
    const [upd] = await conn.query(
      "UPDATE login_security SET role = 'customer' WHERE role = 'sub_admin'"
    );
    if (upd?.affectedRows) {
      console.log(`login_security updated: ${upd.affectedRows}`);
    }
  } catch (_) {
    /* optional table */
  }

  const [after] = await conn.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sub_admins', 'customers')`
  );
  const afterNames = new Set(after.map((t) => t.name));
  let count = 0;
  if (afterNames.has('customers')) {
    const [rows] = await conn.query('SELECT COUNT(*) AS c FROM customers');
    count = rows[0].c;
  }

  console.log('After:', {
    customers: afterNames.has('customers'),
    sub_admins: afterNames.has('sub_admins'),
    customer_count: count
  });

  await conn.end();
  console.log('Done (localhost only).');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
