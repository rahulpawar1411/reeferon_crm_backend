/**
 * Seed demo customers + random chamber / inward / outward logs for local testing.
 * Usage: node scripts/seed-demo-customers-logs.js
 */
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const PASSWORD = 'Customer@123';

const DEMO_CUSTOMERS = [
  {
    email: 'demo.customer1@reeferon.test',
    full_name: 'Demo Customer One',
    phone_no: '9000000001'
  },
  {
    email: 'demo.customer2@reeferon.test',
    full_name: 'Demo Customer Two',
    phone_no: '9000000002'
  },
  {
    email: 'demo.customer3@reeferon.test',
    full_name: 'Demo Customer Three',
    phone_no: '9000000003'
  }
];

function ymdDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randTemp(type) {
  if (type === 'Frozen') return (randInt(-220, -180) / 10).toFixed(1);
  if (type === 'Chilled') return (randInt(0, 50) / 10).toFixed(1);
  if (type === 'Dry') return (randInt(150, 250) / 10).toFixed(1);
  return (randInt(-50, 200) / 10).toFixed(1);
}

function localStamp(daysAgo = 0, hour = 10, minute = 5) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, randInt(0, 59), 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

(async () => {
  console.log('Seeding 3 customers + 50 random logs (20 chamber / 15 inward / 15 outward)…');

  const [ops] = await db.query(
    `SELECT id, email, full_name, warehouse_name, warehouse_code, chamber_limit
     FROM do_operators
     WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) <> ''
     ORDER BY id ASC`
  );
  if (!ops.length) {
    throw new Error('No DO operators with warehouse found. Create a DO first.');
  }

  const primaryDo = ops[0];
  const warehouseName = String(primaryDo.warehouse_name).trim();
  const warehouseCode = primaryDo.warehouse_code || null;
  const operatorEmail = primaryDo.email;

  let [assigns] = await db.query(
    `SELECT cca.chamber_id, c.name AS chamber_name, cca.client_name, cca.client_code,
            COALESCE(NULLIF(TRIM(cca.chamber_type), ''), NULLIF(TRIM(c.chamber_type), ''), 'Frozen') AS chamber_type,
            cca.warehouse_name
     FROM chamber_client_assignments cca
     JOIN chambers c ON c.id = cca.chamber_id
     WHERE (cca.status IS NULL OR cca.status = 'active')
       AND (
         LOWER(TRIM(COALESCE(cca.warehouse_name, ''))) = LOWER(?)
         OR cca.warehouse_name IS NULL
         OR TRIM(cca.warehouse_name) = ''
       )
     ORDER BY cca.id ASC
     LIMIT 40`,
    [warehouseName]
  );

  if (!assigns.length) {
    // Fallback: any active assignment
    [assigns] = await db.query(
      `SELECT cca.chamber_id, c.name AS chamber_name, cca.client_name, cca.client_code,
              COALESCE(NULLIF(TRIM(cca.chamber_type), ''), NULLIF(TRIM(c.chamber_type), ''), 'Frozen') AS chamber_type,
              COALESCE(cca.warehouse_name, ?) AS warehouse_name
       FROM chamber_client_assignments cca
       JOIN chambers c ON c.id = cca.chamber_id
       WHERE (cca.status IS NULL OR cca.status = 'active')
       ORDER BY cca.id ASC
       LIMIT 40`,
      [warehouseName]
    );
  }

  if (!assigns.length) {
    // Create a few demo assignments on first chambers
    const [chambers] = await db.query(
      'SELECT id, name, chamber_type FROM chambers ORDER BY id ASC LIMIT 5'
    );
    const demoClients = ['Amul Seed', 'Mother Dairy Seed', 'ITC Seed'];
    for (let i = 0; i < Math.min(chambers.length, demoClients.length); i++) {
      const ch = chambers[i];
      const client = demoClients[i];
      await db.query(
        `INSERT INTO chamber_client_assignments
         (chamber_id, client_name, warehouse_name, warehouse_code, chamber_type, status)
         VALUES (?, ?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE status = 'active'`,
        [ch.id, client, warehouseName, warehouseCode, ch.chamber_type || 'Frozen']
      );
    }
    [assigns] = await db.query(
      `SELECT cca.chamber_id, c.name AS chamber_name, cca.client_name, cca.client_code,
              COALESCE(NULLIF(TRIM(cca.chamber_type), ''), NULLIF(TRIM(c.chamber_type), ''), 'Frozen') AS chamber_type,
              COALESCE(cca.warehouse_name, ?) AS warehouse_name
       FROM chamber_client_assignments cca
       JOIN chambers c ON c.id = cca.chamber_id
       WHERE (cca.status IS NULL OR cca.status = 'active')
       ORDER BY cca.id DESC
       LIMIT 20`,
      [warehouseName]
    );
  }

  const clientNames = Array.from(
    new Set(assigns.map((a) => String(a.client_name || '').trim()).filter(Boolean))
  );
  const allowedClientsCsv = clientNames.slice(0, 8).join(',');
  const allowedWarehousesCsv = warehouseName;

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(PASSWORD, salt);

  const createdCustomers = [];
  for (const c of DEMO_CUSTOMERS) {
    const [existing] = await db.query('SELECT id, email FROM customers WHERE email = ? LIMIT 1', [
      c.email
    ]);
    if (existing.length) {
      await db.query(
        `UPDATE customers
         SET full_name = ?, phone_no = ?, allowed_clients = ?, allowed_warehouses = ?, password = ?
         WHERE id = ?`,
        [
          c.full_name,
          c.phone_no,
          allowedClientsCsv,
          allowedWarehousesCsv,
          hashed,
          existing[0].id
        ]
      );
      createdCustomers.push({ id: existing[0].id, email: c.email, updated: true });
    } else {
      const [ins] = await db.query(
        `INSERT INTO customers
         (email, password, full_name, phone_no, allowed_clients, allowed_warehouses)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [c.email, hashed, c.full_name, c.phone_no, allowedClientsCsv, allowedWarehousesCsv]
      );
      createdCustomers.push({ id: ins.insertId, email: c.email, updated: false });
    }
  }

  // Ensure client_master has these names for filter options
  for (const name of clientNames.slice(0, 12)) {
    try {
      await db.query(
        `INSERT INTO client_master (client_code, client_name, warehouse_name, is_active)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE is_active = 1, warehouse_name = VALUES(warehouse_name)`,
        [`SEED-${name.slice(0, 8).toUpperCase().replace(/\s+/g, '')}`, name, warehouseName]
      );
    } catch (_) {
      // ignore duplicates / schema quirks
    }
  }

  let chamberInserted = 0;
  for (let i = 0; i < 20; i++) {
    const a = pick(assigns);
    const daysAgo = randInt(0, 12);
    const shift = i % 2 === 0 ? 'Morning' : 'Evening';
    const hour = shift === 'Morning' ? 10 : 16;
    const type = a.chamber_type || 'Frozen';
    const stamp = localStamp(daysAgo, hour, randInt(0, 40));
    const [result] = await db.query(
      `INSERT INTO daily_chamber_temp_logs
       (entry_date, client_name, client_code, chamber_name, chamber_id, inspection_time, box_temp,
        monitor_supervisor_name, temp_sensor_image, warehouse_name, warehouse_code, operator_email,
        is_native, box_count, chamber_type, overdue_time, photo_capture_time, shift, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        ymdDaysAgo(daysAgo),
        a.client_name,
        a.client_code || null,
        a.chamber_name,
        a.chamber_id,
        `${String(hour).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`,
        randTemp(type),
        primaryDo.full_name || 'Seed Supervisor',
        warehouseName,
        warehouseCode,
        operatorEmail,
        randInt(40, 220),
        type,
        stamp,
        shift,
        stamp,
        stamp
      ]
    );
    const ref = `RF-CH-26-${String(result.insertId).padStart(4, '0')}`;
    await db.query('UPDATE daily_chamber_temp_logs SET reference_no = ? WHERE id = ?', [
      ref,
      result.insertId
    ]);
    chamberInserted += 1;
  }

  let inwardInserted = 0;
  for (let i = 0; i < 15; i++) {
    const a = pick(assigns);
    const daysAgo = randInt(0, 14);
    const boxes = randInt(50, 400);
    const shortQty = Math.random() < 0.25 ? randInt(0, 8) : 0;
    const excessQty = Math.random() < 0.2 ? randInt(0, 6) : 0;
    const stamp = localStamp(daysAgo, randInt(9, 17), randInt(0, 50));
    const [result] = await db.query(
      `INSERT INTO inward_temp_logs
       (inward_entry_date, inward_vehicle_no, inward_seal_no, inward_vehicle_temp, inward_material_temp,
        inward_transporter_name, inward_driver_name, inward_driver_no, inward_client_name, inward_dock_no,
        inward_vehicle_reporting_time, inward_unloading_start_time, inward_unloading_duration_hours,
        inward_unloading_duration_mins, inward_unloading_end_time, inward_pallets_in_qty, inward_invoice_qty,
        inward_received_qty, inward_received_boxes_qty, inward_short_received_boxes_qty,
        inward_excess_received_boxes_qty, inward_damage_received_boxes_qty, inward_material_type,
        inward_unloading_supervisor_name, inward_remarks, inward_created_at, inward_updated_at,
        warehouse_name, warehouse_code, inward_client_code, operator_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ymdDaysAgo(daysAgo),
        `MH${randInt(12, 99)}${randInt(1000, 9999)}`,
        `SL-${randInt(10000, 99999)}`,
        randTemp(a.chamber_type || 'Frozen'),
        randTemp(a.chamber_type || 'Frozen'),
        pick(['BlueDart Cold', 'Gati Reefer', 'TCI Supply', 'SafeExpress']),
        pick(['Ramesh', 'Suresh', 'Imran', 'Vikas', 'Arjun']),
        `9${randInt(100000000, 999999999)}`,
        a.client_name,
        `D${randInt(1, 6)}`,
        '09:30',
        '10:00',
        '1',
        '20',
        '11:20',
        randInt(5, 25),
        boxes,
        boxes - shortQty + excessQty,
        boxes - shortQty + excessQty,
        shortQty,
        excessQty,
        Math.random() < 0.15 ? randInt(1, 4) : 0,
        pick(['Frozen Food', 'Dairy', 'Meat', 'Ice Cream', 'Vegetables']),
        primaryDo.full_name || 'Seed Supervisor',
        'Seeded demo inward log',
        stamp,
        stamp,
        warehouseName,
        warehouseCode,
        a.client_code || null,
        operatorEmail
      ]
    );
    const ref = `RF-IN-26-${String(result.insertId).padStart(4, '0')}`;
    await db.query('UPDATE inward_temp_logs SET reference_no = ? WHERE inward_id = ?', [
      ref,
      result.insertId
    ]);
    inwardInserted += 1;
  }

  let outwardInserted = 0;
  for (let i = 0; i < 15; i++) {
    const a = pick(assigns);
    const daysAgo = randInt(0, 14);
    const boxes = randInt(30, 280);
    const stamp = localStamp(daysAgo, randInt(10, 18), randInt(0, 50));
    const [result] = await db.query(
      `INSERT INTO outward_temp_logs
       (outward_entry_date, outward_vehicle_no, outward_seal_no, outward_vehicle_temp, outward_pre_vehicle_temp,
        outward_material_temp, outward_transporter_name, outward_driver_name, outward_driver_no,
        outward_client_name, outward_dock_no, outward_vehicle_reporting_time, outward_loading_start_time,
        outward_loading_duration_hours, outward_loading_duration_mins, outward_loading_end_time,
        outward_pallets_in_qty, outward_invoice_qty, outward_received_qty, outward_received_boxes_qty,
        outward_short_received_boxes_qty, outward_excess_received_boxes_qty, outward_damage_received_boxes_qty,
        outward_material_type, outward_loading_supervisor_name, outward_remarks, outward_created_at,
        outward_updated_at, warehouse_name, warehouse_code, outward_client_code, operator_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ymdDaysAgo(daysAgo),
        `GJ${randInt(1, 36)}${randInt(1000, 9999)}`,
        `OS-${randInt(10000, 99999)}`,
        randTemp(a.chamber_type || 'Frozen'),
        randTemp(a.chamber_type || 'Frozen'),
        randTemp(a.chamber_type || 'Frozen'),
        pick(['BlueDart Cold', 'Gati Reefer', 'TCI Supply', 'SafeExpress']),
        pick(['Ramesh', 'Suresh', 'Imran', 'Vikas', 'Arjun']),
        `9${randInt(100000000, 999999999)}`,
        a.client_name,
        `D${randInt(1, 6)}`,
        '12:00',
        '12:20',
        '1',
        '10',
        '13:30',
        randInt(4, 20),
        boxes,
        boxes,
        boxes,
        0,
        0,
        Math.random() < 0.1 ? randInt(1, 3) : 0,
        pick(['Frozen Food', 'Dairy', 'Meat', 'Ice Cream', 'Vegetables']),
        primaryDo.full_name || 'Seed Supervisor',
        'Seeded demo outward log',
        stamp,
        stamp,
        warehouseName,
        warehouseCode,
        a.client_code || null,
        operatorEmail
      ]
    );
    const ref = `RF-OUT-26-${String(result.insertId).padStart(4, '0')}`;
    await db.query('UPDATE outward_temp_logs SET reference_no = ? WHERE outward_id = ?', [
      ref,
      result.insertId
    ]);
    outwardInserted += 1;
  }

  console.log('\nDone.');
  console.log('Warehouse used:', warehouseName, warehouseCode || '');
  console.log('Operator:', operatorEmail);
  console.log('Customers (password = Customer@123):');
  createdCustomers.forEach((c) => {
    console.log(`  - ${c.email} (id=${c.id}${c.updated ? ', updated' : ', created'})`);
  });
  console.log('Allowed clients:', allowedClientsCsv);
  console.log(
    `Logs inserted: chamber=${chamberInserted}, inward=${inwardInserted}, outward=${outwardInserted}, total=${
      chamberInserted + inwardInserted + outwardInserted
    }`
  );

  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});
