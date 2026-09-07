#!/usr/bin/env node
/**
 * Reset login lockout for one email (after too many wrong passwords).
 * Usage: node scripts/unlock-login.js admin@reeferon.com
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/unlock-login.js <email>');
    process.exit(1);
  }

  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
  });

  const [result] = await c.query(
    'UPDATE login_security SET failed_count = 0, locked_until = NULL, last_failed_at = NULL WHERE LOWER(email) = ?',
    [email]
  );
  console.log(`Unlocked ${email} (${result.affectedRows} row(s) updated).`);
  console.log('Also restart backend (npm start) to clear IP rate limit (15 min window).');
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
