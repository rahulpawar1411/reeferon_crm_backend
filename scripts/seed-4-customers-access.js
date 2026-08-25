/**
 * Seed 4 Customers with mixed warehouse + client access.
 * Usage: node scripts/seed-4-customers-access.js
 */
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const PASSWORD = 'Customer@123';

(async () => {
  console.log('Seeding 4 customers with mixed WH/client access…');

  const [warehouses] = await db.query(
    `SELECT warehouse_name, warehouse_code
     FROM warehouse_master
     WHERE is_active = 1
     ORDER BY warehouse_name ASC`
  );
  if (warehouses.length < 2) {
    throw new Error('Need at least 2 warehouses. Seed DOs first (seed-3-dos-logs.js).');
  }

  const [clients] = await db.query(
    `SELECT client_name, warehouse_name
     FROM client_master
     WHERE is_active = 1
     ORDER BY warehouse_name, client_name`
  );
  if (!clients.length) {
    throw new Error('No clients in client_master. Seed DOs first.');
  }

  const byWh = {};
  clients.forEach((c) => {
    const wh = String(c.warehouse_name || '').trim();
    if (!wh) return;
    if (!byWh[wh]) byWh[wh] = [];
    const name = String(c.client_name || '').trim();
    if (name && !byWh[wh].includes(name)) byWh[wh].push(name);
  });

  const whNames = [...warehouses.map((w) => w.warehouse_name)];
  const findWh = (needle) =>
    whNames.find((w) => w.toLowerCase().includes(String(needle).toLowerCase())) || whNames[0];
  const whBhopal = findWh('bhopal');
  const whPune = findWh('pune');
  const whIndore = findWh('indore');

  const clientsOf = (wh) => byWh[wh] || [];
  const sharedAcross = (names) => {
    // Prefer Amul Shared / Mother Dairy Shared if present
    const preferred = ['Amul Shared', 'Mother Dairy Shared'];
    const hit = preferred.filter((p) => names.includes(p));
    return hit.length ? hit : names.slice(0, 2);
  };

  const DEFINITIONS = [
    {
      email: 'customer.bhopal@reeferon.test',
      full_name: 'Customer Bhopal Only',
      phone_no: '9811111101',
      // Single warehouse, all clients of that WH
      allowed_warehouses: whBhopal,
      allowed_clients: clientsOf(whBhopal).join(','),
      note: `Only ${whBhopal} + all its clients`
    },
    {
      email: 'customer.pune.shared@reeferon.test',
      full_name: 'Customer Pune Shared Clients',
      phone_no: '9811111102',
      // Same style single WH but ONLY shared clients (overlap with other WH names)
      allowed_warehouses: whPune,
      allowed_clients: sharedAcross(clientsOf(whPune)).join(','),
      note: `Only ${whPune} + shared clients only`
    },
    {
      email: 'customer.multi@reeferon.test',
      full_name: 'Customer Multi Warehouse',
      phone_no: '9811111103',
      // Different: 2 warehouses, shared + one unique from each
      allowed_warehouses: `${whBhopal},${whIndore}`,
      allowed_clients: Array.from(
        new Set([
          ...sharedAcross(clientsOf(whBhopal)),
          ...sharedAcross(clientsOf(whIndore)),
          ...(clientsOf(whBhopal)
            .filter((c) => !sharedAcross(clientsOf(whBhopal)).includes(c))
            .slice(0, 1)),
          ...(clientsOf(whIndore)
            .filter((c) => !sharedAcross(clientsOf(whIndore)).includes(c))
            .slice(0, 1))
        ])
      ).join(','),
      note: `Multi WH: ${whBhopal} + ${whIndore} (shared + unique mix)`
    },
    {
      email: 'customer.allthree@reeferon.test',
      full_name: 'Customer All Three WH',
      phone_no: '9811111104',
      // Broad access: all warehouses, only shared client names
      allowed_warehouses: [whBhopal, whPune, whIndore].filter(Boolean).join(','),
      allowed_clients: Array.from(
        new Set(
          [whBhopal, whPune, whIndore].filter(Boolean).flatMap((w) => sharedAcross(clientsOf(w)))
        )
      ).join(','),
      note: `All warehouses + shared clients only`
    }
  ];

  const salt = await bcrypt.genSalt(10);
  const hashed = await bcrypt.hash(PASSWORD, salt);
  const created = [];

  for (const def of DEFINITIONS) {
    const [existing] = await db.query('SELECT id FROM customers WHERE email = ? LIMIT 1', [
      def.email
    ]);
    if (existing.length) {
      await db.query(
        `UPDATE customers
         SET password = ?, full_name = ?, phone_no = ?, allowed_clients = ?, allowed_warehouses = ?
         WHERE id = ?`,
        [
          hashed,
          def.full_name,
          def.phone_no,
          def.allowed_clients,
          def.allowed_warehouses,
          existing[0].id
        ]
      );
      created.push({ ...def, id: existing[0].id, updated: true });
    } else {
      const [ins] = await db.query(
        `INSERT INTO customers
         (email, password, full_name, phone_no, allowed_clients, allowed_warehouses)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          def.email,
          hashed,
          def.full_name,
          def.phone_no,
          def.allowed_clients,
          def.allowed_warehouses
        ]
      );
      created.push({ ...def, id: ins.insertId, updated: false });
    }
  }

  console.log('\nDone.');
  console.log(`Password for all customers: ${PASSWORD}`);
  created.forEach((c) => {
    console.log(`\n- ${c.email} (${c.updated ? 'updated' : 'created'}) id=${c.id}`);
    console.log(`  name: ${c.full_name}`);
    console.log(`  warehouses: ${c.allowed_warehouses}`);
    console.log(`  clients: ${c.allowed_clients}`);
    console.log(`  pattern: ${c.note}`);
  });

  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err.message || err);
  process.exit(1);
});
