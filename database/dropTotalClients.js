/**
 * Drop chambers.total_clients — completion now uses Master Setup client count.
 * Usage: node database/dropTotalClients.js
 */
require('dotenv').config();
const db = require('../config/db');

async function run() {
  const conn = await db.getConnection();
  try {
    const [cols] = await conn.query('SHOW COLUMNS FROM chambers LIKE ?', ['total_clients']);
    if (cols.length === 0) {
      console.log('total_clients already absent from chambers.');
    } else {
      await conn.query('ALTER TABLE chambers DROP COLUMN total_clients');
      console.log('Dropped chambers.total_clients');
    }
    const [sample] = await conn.query('SELECT id, name FROM chambers LIMIT 5');
    console.log('chambers sample:', sample);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  }
}

run();
