/**
 * Clear all business/store data from local MySQL (keep schema + super_admin login).
 * Usage: node scripts/clear-store-data.js
 */
const db = require('../config/db');

const TABLES_IN_ORDER = [
  // child / log tables first
  'daily_chamber_temp_logs',
  'do_daily_inspections',
  'daily_temp_logs',
  'inward_temp_logs',
  'outward_temp_logs',
  'chamber_client_assignments',
  'do_operator_activities',
  'customer_admin_notes',
  'customer_reports',
  'login_security',
  'leads',
  // permission / activity style tables (ignore if missing)
  'permission_requests',
  'do_permission_requests',
  'activity_logs',
  'operator_activities',
  // masters & accounts (keep super_admin)
  'customers',
  'do_operators',
  'client_master',
  'warehouse_master',
  'chambers'
  // note: sub_admins intentionally kept (mobile sub-admin accounts)
];

(async () => {
  console.log('Clearing store data (keeping super_admin + table schema)…');

  // Disable FK checks for truncate-like deletes
  await db.query('SET FOREIGN_KEY_CHECKS = 0');

  const results = [];
  for (const table of TABLES_IN_ORDER) {
    try {
      const [before] = await db.query(`SELECT COUNT(*) AS c FROM ${table}`);
      await db.query(`DELETE FROM ${table}`);
      // reset auto-increment where possible
      try {
        await db.query(`ALTER TABLE ${table} AUTO_INCREMENT = 1`);
      } catch (_) {}
      results.push({ table, cleared: before[0].c, ok: true });
    } catch (e) {
      results.push({ table, ok: false, error: e.message });
    }
  }

  await db.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log('\nResult:');
  for (const r of results) {
    if (r.ok) console.log(`  ✓ ${r.table}: deleted ${r.cleared} rows`);
    else console.log(`  · ${r.table}: skipped (${r.error})`);
  }

  try {
    const [sa] = await db.query('SELECT id, email FROM super_admin LIMIT 5');
    console.log('\nKept super_admin:', sa);
  } catch (e) {
    console.log('\nsuper_admin check failed:', e.message);
  }

  try {
    const [sub] = await db.query('SELECT id, email FROM sub_admins LIMIT 10');
    console.log('Kept sub_admins:', sub);
  } catch (_) {}

  console.log('\nStore data clear complete.');
  process.exit(0);
})().catch((err) => {
  console.error('Clear failed:', err.message || err);
  process.exit(1);
});
