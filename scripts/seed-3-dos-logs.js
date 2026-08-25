/**
 * Seed 3 DO profiles + 40 logs (20 chamber temp, 10 inward, 10 outward).
 * Usage: node scripts/seed-3-dos-logs.js
 */
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const DO_PASSWORD = 'Do@123';

const DOS = [
  {
    email: 'do1@reeferon.test',
    full_name: 'DO Bhopal',
    phone_no: '9111111111',
    warehouse_name: 'Bhopal WH',
    warehouse_code: 'WH-BPL-01',
    city: 'Bhopal',
    chamber_limit: 4,
    uniqueClients: ['BPL Dairy', 'BPL Frozen Foods'],
    sharedClients: ['Amul Shared', 'Mother Dairy Shared']
  },
  {
    email: 'do2@reeferon.test',
    full_name: 'DO Pune',
    phone_no: '9222222222',
    warehouse_name: 'Pune WH',
    warehouse_code: 'WH-PUN-01',
    city: 'Pune',
    chamber_limit: 4,
    uniqueClients: ['Pune Fresh Lot', 'Pune Ice Cream'],
    sharedClients: ['Amul Shared', 'Mother Dairy Shared']
  },
  {
    email: 'do3@reeferon.test',
    full_name: 'DO Indore',
    phone_no: '9333333333',
    warehouse_name: 'Indore WH',
    warehouse_code: 'WH-IND-01',
    city: 'Indore',
    chamber_limit: 4,
    uniqueClients: ['Indore Meat Co', 'Indore Veg Cold'],
    sharedClients: ['Amul Shared', 'Mother Dairy Shared']
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
  if (type === 'Frozen') return Number((randInt(-220, -180) / 10).toFixed(1));
  if (type === 'Chilled') return Number((randInt(0, 50) / 10).toFixed(1));
  if (type === 'Dry') return Number((randInt(150, 250) / 10).toFixed(1));
  return Number((randInt(-50, 200) / 10).toFixed(1));
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

function clientCode(name, whCode) {
  const base = String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  const wh = String(whCode || 'WH').replace(/[^A-Z0-9]/gi, '').slice(-4);
  return `${base || 'CLI'}-${wh}`;
}

(async () => {
  console.log('Seeding 3 DO profiles + 20 chamber / 10 inward / 10 outward…');

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(DO_PASSWORD, salt);
  const chamberTypes = ['Frozen', 'Chilled', 'Dry', 'Frozen'];
  const doContexts = [];

  for (const doDef of DOS) {
    // warehouse master
    await db.query(
      `INSERT INTO warehouse_master (warehouse_code, warehouse_name, city, is_active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         warehouse_name = VALUES(warehouse_name),
         city = VALUES(city),
         is_active = 1`,
      [doDef.warehouse_code, doDef.warehouse_name, doDef.city]
    );

    // DO account
    const [existingDo] = await db.query(
      'SELECT id FROM do_operators WHERE email = ? LIMIT 1',
      [doDef.email]
    );
    let doId;
    if (existingDo.length) {
      doId = existingDo[0].id;
      await db.query(
        `UPDATE do_operators
         SET password = ?, full_name = ?, phone_no = ?, warehouse_name = ?, warehouse_code = ?, chamber_limit = ?
         WHERE id = ?`,
        [
          hashed,
          doDef.full_name,
          doDef.phone_no,
          doDef.warehouse_name,
          doDef.warehouse_code,
          doDef.chamber_limit,
          doId
        ]
      );
    } else {
      const [ins] = await db.query(
        `INSERT INTO do_operators
         (email, password, full_name, phone_no, warehouse_name, warehouse_code, chamber_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          doDef.email,
          hashed,
          doDef.full_name,
          doDef.phone_no,
          doDef.warehouse_name,
          doDef.warehouse_code,
          doDef.chamber_limit
        ]
      );
      doId = ins.insertId;
    }

    // 4 chambers per DO
    const assignments = [];
    const clients = [...doDef.sharedClients, ...doDef.uniqueClients];
    for (let i = 0; i < 4; i++) {
      const chamberName = `${doDef.city} Chamber ${i + 1}`;
      const type = chamberTypes[i % chamberTypes.length];
      const [chIns] = await db.query(
        'INSERT INTO chambers (name, chamber_type) VALUES (?, ?)',
        [chamberName, type]
      );
      const chamberId = chIns.insertId;
      const clientName = clients[i % clients.length];
      const code = clientCode(clientName, doDef.warehouse_code);

      try {
        await db.query(
          `INSERT INTO client_master (client_code, client_name, warehouse_name, is_active)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             client_name = VALUES(client_name),
             warehouse_name = VALUES(warehouse_name),
             is_active = 1`,
          [code, clientName, doDef.warehouse_name]
        );
      } catch (_) {}

      await db.query(
        `INSERT INTO chamber_client_assignments
         (chamber_id, client_name, client_code, warehouse_name, warehouse_code, chamber_type, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [
          chamberId,
          clientName,
          code,
          doDef.warehouse_name,
          doDef.warehouse_code,
          type
        ]
      );

      assignments.push({
        chamber_id: chamberId,
        chamber_name: chamberName,
        chamber_type: type,
        client_name: clientName,
        client_code: code,
        warehouse_name: doDef.warehouse_name,
        warehouse_code: doDef.warehouse_code,
        operator_email: doDef.email,
        supervisor: doDef.full_name
      });
    }

    doContexts.push({ ...doDef, id: doId, assignments });
  }

  const allAssignments = doContexts.flatMap((d) => d.assignments);

  // 20 chamber temp — distribute across 3 DOs (~7/7/6)
  let chamberCount = 0;
  for (let i = 0; i < 20; i++) {
    const a = allAssignments[i % allAssignments.length];
    const daysAgo = randInt(0, 10);
    const shift = i % 2 === 0 ? 'Morning' : 'Evening';
    const hour = shift === 'Morning' ? 10 : 16;
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
        a.client_code,
        a.chamber_name,
        a.chamber_id,
        `${String(hour).padStart(2, '0')}:${String(randInt(0, 59)).padStart(2, '0')}`,
        randTemp(a.chamber_type),
        a.supervisor,
        a.warehouse_name,
        a.warehouse_code,
        a.operator_email,
        randInt(40, 220),
        a.chamber_type,
        stamp,
        shift,
        stamp,
        stamp
      ]
    );
    await db.query('UPDATE daily_chamber_temp_logs SET reference_no = ? WHERE id = ?', [
      `RF-CH-26-${String(result.insertId).padStart(4, '0')}`,
      result.insertId
    ]);
    chamberCount += 1;
  }

  // 10 inward
  let inwardCount = 0;
  for (let i = 0; i < 10; i++) {
    const a = allAssignments[i % allAssignments.length];
    const daysAgo = randInt(0, 12);
    const boxes = randInt(60, 350);
    const shortQty = Math.random() < 0.3 ? randInt(0, 6) : 0;
    const stamp = localStamp(daysAgo, randInt(9, 16), randInt(0, 40));
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
        randTemp(a.chamber_type),
        randTemp(a.chamber_type),
        pick(['BlueDart Cold', 'Gati Reefer', 'TCI Supply']),
        pick(['Ramesh', 'Suresh', 'Imran', 'Vikas']),
        `9${randInt(100000000, 999999999)}`,
        a.client_name,
        `D${randInt(1, 4)}`,
        '09:30',
        '10:00',
        '1',
        '15',
        '11:15',
        randInt(5, 20),
        boxes,
        boxes - shortQty,
        boxes - shortQty,
        shortQty,
        0,
        0,
        pick(['Frozen Food', 'Dairy', 'Meat', 'Ice Cream']),
        a.supervisor,
        'Seeded inward',
        stamp,
        stamp,
        a.warehouse_name,
        a.warehouse_code,
        a.client_code,
        a.operator_email
      ]
    );
    await db.query('UPDATE inward_temp_logs SET reference_no = ? WHERE inward_id = ?', [
      `RF-IN-26-${String(result.insertId).padStart(4, '0')}`,
      result.insertId
    ]);
    inwardCount += 1;
  }

  // 10 outward
  let outwardCount = 0;
  for (let i = 0; i < 10; i++) {
    const a = allAssignments[(i + 3) % allAssignments.length];
    const daysAgo = randInt(0, 12);
    const boxes = randInt(40, 260);
    const stamp = localStamp(daysAgo, randInt(11, 18), randInt(0, 40));
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
        randTemp(a.chamber_type),
        randTemp(a.chamber_type),
        randTemp(a.chamber_type),
        pick(['BlueDart Cold', 'Gati Reefer', 'TCI Supply']),
        pick(['Ramesh', 'Suresh', 'Imran', 'Vikas']),
        `9${randInt(100000000, 999999999)}`,
        a.client_name,
        `D${randInt(1, 4)}`,
        '12:00',
        '12:20',
        '1',
        '10',
        '13:20',
        randInt(4, 18),
        boxes,
        boxes,
        boxes,
        0,
        0,
        0,
        pick(['Frozen Food', 'Dairy', 'Meat', 'Ice Cream']),
        a.supervisor,
        'Seeded outward',
        stamp,
        stamp,
        a.warehouse_name,
        a.warehouse_code,
        a.client_code,
        a.operator_email
      ]
    );
    await db.query('UPDATE outward_temp_logs SET reference_no = ? WHERE outward_id = ?', [
      `RF-OUT-26-${String(result.insertId).padStart(4, '0')}`,
      result.insertId
    ]);
    outwardCount += 1;
  }

  console.log('\nDone.');
  console.log(`Password for all DOs: ${DO_PASSWORD}`);
  for (const d of doContexts) {
    console.log(
      `  - ${d.email} | ${d.full_name} | ${d.warehouse_name} (${d.warehouse_code}) | chambers=${d.assignments.length}`
    );
  }
  console.log(
    `Logs: chamber=${chamberCount}, inward=${inwardCount}, outward=${outwardCount}, total=${
      chamberCount + inwardCount + outwardCount
    }`
  );
  console.log('Shared clients on all 3 WH: Amul Shared, Mother Dairy Shared');

  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});
