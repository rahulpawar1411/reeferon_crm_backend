/**
 * Duplicate = same form posted twice (tap + sync), not two real trips.
 * Date/vehicle/warehouse/client/operator often match on real trips too,
 * so also require dock, times, seal, and qty to match.
 */

function timeKey(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
}

function textKey(value) {
  return String(value || '').trim().toLowerCase();
}

function qtyKey(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function sameInwardTrip(row, fields) {
  return (
    textKey(row.inward_dock_no) === textKey(fields.dock) &&
    textKey(row.inward_seal_no) === textKey(fields.seal) &&
    timeKey(row.inward_vehicle_reporting_time) === timeKey(fields.reportingTime) &&
    timeKey(row.inward_unloading_start_time) === timeKey(fields.startTime) &&
    qtyKey(row.inward_invoice_qty) === qtyKey(fields.invoiceQty) &&
    qtyKey(row.inward_received_boxes_qty) === qtyKey(fields.receivedQty)
  );
}

function sameOutwardTrip(row, fields) {
  return (
    textKey(row.outward_dock_no) === textKey(fields.dock) &&
    textKey(row.outward_seal_no) === textKey(fields.seal) &&
    timeKey(row.outward_vehicle_reporting_time) === timeKey(fields.reportingTime) &&
    timeKey(row.outward_loading_start_time) === timeKey(fields.startTime) &&
    qtyKey(row.outward_invoice_qty) === qtyKey(fields.invoiceQty) &&
    qtyKey(row.outward_received_boxes_qty) === qtyKey(fields.receivedQty)
  );
}

async function findRecentInwardDuplicate(db, fields) {
  if (!fields.date || !fields.vehicle) return null;
  const [rows] = await db.query(
    `SELECT inward_id AS id, reference_no, inward_dock_no, inward_seal_no,
            inward_vehicle_reporting_time, inward_unloading_start_time,
            inward_invoice_qty, inward_received_boxes_qty
     FROM inward_temp_logs
     WHERE inward_entry_date = ?
       AND TRIM(LOWER(inward_vehicle_no)) = TRIM(LOWER(?))
       AND TRIM(LOWER(IFNULL(warehouse_name,''))) = TRIM(LOWER(IFNULL(?,'')))
       AND TRIM(LOWER(IFNULL(inward_client_name,''))) = TRIM(LOWER(IFNULL(?,'')))
       AND TRIM(LOWER(IFNULL(operator_email,''))) = TRIM(LOWER(IFNULL(?,'')))
       AND inward_created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
     ORDER BY inward_id DESC
     LIMIT 8`,
    [
      fields.date,
      String(fields.vehicle).trim(),
      fields.warehouse || '',
      fields.client || '',
      fields.operator || ''
    ]
  );
  const hit = rows.find((row) => sameInwardTrip(row, fields));
  return hit ? { id: hit.id, reference_no: hit.reference_no } : null;
}

async function findRecentOutwardDuplicate(db, fields) {
  if (!fields.date || !fields.vehicle) return null;
  const [rows] = await db.query(
    `SELECT outward_id AS id, reference_no, outward_dock_no, outward_seal_no,
            outward_vehicle_reporting_time, outward_loading_start_time,
            outward_invoice_qty, outward_received_boxes_qty
     FROM outward_temp_logs
     WHERE outward_entry_date = ?
       AND TRIM(LOWER(outward_vehicle_no)) = TRIM(LOWER(?))
       AND TRIM(LOWER(IFNULL(warehouse_name,''))) = TRIM(LOWER(IFNULL(?,'')))
       AND TRIM(LOWER(IFNULL(outward_client_name,''))) = TRIM(LOWER(IFNULL(?,'')))
       AND TRIM(LOWER(IFNULL(operator_email,''))) = TRIM(LOWER(IFNULL(?,'')))
       AND outward_created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
     ORDER BY outward_id DESC
     LIMIT 8`,
    [
      fields.date,
      String(fields.vehicle).trim(),
      fields.warehouse || '',
      fields.client || '',
      fields.operator || ''
    ]
  );
  const hit = rows.find((row) => sameOutwardTrip(row, fields));
  return hit ? { id: hit.id, reference_no: hit.reference_no } : null;
}

module.exports = {
  findRecentInwardDuplicate,
  findRecentOutwardDuplicate
};
