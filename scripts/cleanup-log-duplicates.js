/**
 * Remove accidental double-saves of inward/outward logs.
 * Keeps the first row (lowest id). Deletes extras only when the same
 * trip identity matches AND both rows were submitted within 10 minutes.
 *
 *   node scripts/cleanup-log-duplicates.js          # preview
 *   node scripts/cleanup-log-duplicates.js --apply  # delete extras
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

const inwardSql = `
SELECT a.inward_id keep_id, b.inward_id extra_id,
       a.reference_no keep_ref, b.reference_no extra_ref,
       DATE_FORMAT(a.inward_entry_date,'%Y-%m-%d') entry_date,
       a.inward_vehicle_no vehicle, a.inward_client_name client,
       a.warehouse_name warehouse,
       a.inward_created_at keep_at, b.inward_created_at extra_at,
       TIMESTAMPDIFF(SECOND, a.inward_created_at, b.inward_created_at) seconds_apart
FROM inward_temp_logs a
JOIN inward_temp_logs b
  ON a.inward_id < b.inward_id
 AND a.inward_entry_date = b.inward_entry_date
 AND TRIM(LOWER(a.inward_vehicle_no)) = TRIM(LOWER(b.inward_vehicle_no))
 AND TRIM(LOWER(IFNULL(a.warehouse_name,''))) = TRIM(LOWER(IFNULL(b.warehouse_name,'')))
 AND TRIM(LOWER(IFNULL(a.inward_client_name,''))) = TRIM(LOWER(IFNULL(b.inward_client_name,'')))
 AND TRIM(LOWER(IFNULL(a.operator_email,''))) = TRIM(LOWER(IFNULL(b.operator_email,'')))
 AND ABS(TIMESTAMPDIFF(MINUTE, a.inward_created_at, b.inward_created_at)) <= 10
`;

const outwardSql = `
SELECT a.outward_id keep_id, b.outward_id extra_id,
       a.reference_no keep_ref, b.reference_no extra_ref,
       DATE_FORMAT(a.outward_entry_date,'%Y-%m-%d') entry_date,
       a.outward_vehicle_no vehicle, a.outward_client_name client,
       a.warehouse_name warehouse,
       a.outward_created_at keep_at, b.outward_created_at extra_at,
       TIMESTAMPDIFF(SECOND, a.outward_created_at, b.outward_created_at) seconds_apart
FROM outward_temp_logs a
JOIN outward_temp_logs b
  ON a.outward_id < b.outward_id
 AND a.outward_entry_date = b.outward_entry_date
 AND TRIM(LOWER(a.outward_vehicle_no)) = TRIM(LOWER(b.outward_vehicle_no))
 AND TRIM(LOWER(IFNULL(a.warehouse_name,''))) = TRIM(LOWER(IFNULL(b.warehouse_name,'')))
 AND TRIM(LOWER(IFNULL(a.outward_client_name,''))) = TRIM(LOWER(IFNULL(b.outward_client_name,'')))
 AND TRIM(LOWER(IFNULL(a.operator_email,''))) = TRIM(LOWER(IFNULL(b.operator_email,'')))
 AND ABS(TIMESTAMPDIFF(MINUTE, a.outward_created_at, b.outward_created_at)) <= 10
`;

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  const [inward] = await db.query(inwardSql);
  const [outward] = await db.query(outwardSql);
  const [[inCount]] = await db.query('SELECT COUNT(*) AS c FROM inward_temp_logs');
  const [[outCount]] = await db.query('SELECT COUNT(*) AS c FROM outward_temp_logs');

  const extraIn = [...new Set(inward.map((r) => r.extra_id))];
  const extraOut = [...new Set(outward.map((r) => r.extra_id))];

  console.log(`DB: ${process.env.DB_HOST} / ${process.env.DB_NAME}`);
  console.log(`Mode: ${APPLY ? 'APPLY (delete extras)' : 'PREVIEW (no delete)'}`);
  console.log(`Inward total: ${inCount.c} | extra copies: ${extraIn.length}`);
  console.log(`Outward total: ${outCount.c} | extra copies: ${extraOut.length}`);
  console.log('\n--- Inward extras ---');
  console.table(
    inward.map((r) => ({
      keep: `${r.keep_id} ${r.keep_ref || ''}`,
      extra: `${r.extra_id} ${r.extra_ref || ''}`,
      date: r.entry_date,
      vehicle: r.vehicle,
      client: r.client,
      warehouse: r.warehouse,
      seconds_apart: r.seconds_apart
    }))
  );
  console.log('\n--- Outward extras ---');
  console.table(
    outward.map((r) => ({
      keep: `${r.keep_id} ${r.keep_ref || ''}`,
      extra: `${r.extra_id} ${r.extra_ref || ''}`,
      date: r.entry_date,
      vehicle: r.vehicle,
      client: r.client,
      warehouse: r.warehouse,
      seconds_apart: r.seconds_apart
    }))
  );

  if (!APPLY) {
    console.log('\nPreview only. Re-run with --apply to delete extra copies (first row is kept).');
    await db.end();
    return;
  }

  if (extraIn.length) {
    await db.query(
      `DELETE FROM inward_temp_logs WHERE inward_id IN (${extraIn.map(() => '?').join(',')})`,
      extraIn
    );
  }

  if (extraOut.length) {
    await db.query(
      `DELETE FROM outward_temp_logs WHERE outward_id IN (${extraOut.map(() => '?').join(',')})`,
      extraOut
    );
  }

  const [[inAfter]] = await db.query('SELECT COUNT(*) AS c FROM inward_temp_logs');
  const [[outAfter]] = await db.query('SELECT COUNT(*) AS c FROM outward_temp_logs');
  console.log(`\nDeleted inward extras: ${extraIn.length} | remaining: ${inAfter.c}`);
  console.log(`Deleted outward extras: ${extraOut.length} | remaining: ${outAfter.c}`);
  await db.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
