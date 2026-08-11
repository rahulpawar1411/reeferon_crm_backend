// ====================================================================
// Dashboard Controller (controllers/dashboardController.js)
// --------------------------------------------------------------------
// Mobile/web summary APIs: stats, inventory reconciliation, DO task overview.
// Errors: always return via handleControllerError (safe message + checkpoint).
// Customer inventory rows are filtered by allowed_clients / allowed_warehouses.
// ====================================================================

const db = require('../config/db');
const { handleControllerError } = require('../utils/errorHandler');

function parseCsvNames(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Scope inventory rows to customer allowed clients / warehouses. */
function applyCustomerInventoryScope(rows, user) {
  if (!user || user.role !== 'customer') return rows;
  const clients = parseCsvNames(user.allowed_clients).map((c) => c.toLowerCase());
  const warehouses = parseCsvNames(user.allowed_warehouses).map((w) => w.toLowerCase());
  if (clients.length === 0 && warehouses.length === 0) return rows;

  return (rows || []).filter((r) => {
    const client = String(r.client_name || '').trim().toLowerCase();
    const warehouse = String(r.warehouse_name || '').trim().toLowerCase();
    const clientOk = clients.length === 0 || clients.includes(client);
    const warehouseOk = warehouses.length === 0 || warehouses.includes(warehouse);
    return clientOk && warehouseOk;
  });
}

/** Scope inventory rows to DO operator warehouse + assigned clients. */
async function applyDoInventoryScope(rows, user) {
  if (!user || user.role !== 'do_operator') return rows;

  let warehouse = String(user.warehouse_name || user.warehouse || '').trim();
  let limit = parseInt(user.chamber_limit || 4, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 4;

  try {
    const [opRows] = await db.query(
      'SELECT warehouse_name, chamber_limit FROM do_operators WHERE email = ? LIMIT 1',
      [user.email]
    );
    if (opRows.length > 0) {
      if (opRows[0].warehouse_name) {
        warehouse = String(opRows[0].warehouse_name).trim();
      }
      const lim = parseInt(opRows[0].chamber_limit || limit, 10);
      if (Number.isFinite(lim) && lim >= 1) limit = lim;
    }
  } catch (_) {
    // keep JWT/profile values
  }

  let filtered = Array.isArray(rows) ? [...rows] : [];
  const whLower = warehouse.toLowerCase();

  // Same rule as chamber-temp DO access: own warehouse OR blank warehouse
  if (whLower) {
    filtered = filtered.filter((r) => {
      const wh = String(r.warehouse_name || '').trim().toLowerCase();
      return !wh || wh === whLower;
    });
  }

  // Clients the DO can work with: active assignments for their warehouse + chamber limit
  try {
    const [assignRows] = await db.query(
      `SELECT cca.client_name, c.name AS chamber_name
       FROM chamber_client_assignments cca
       JOIN chambers c ON cca.chamber_id = c.id
       WHERE cca.status = 'active'
         AND (
           ? = ''
           OR cca.warehouse_name IS NULL
           OR TRIM(cca.warehouse_name) = ''
           OR LOWER(TRIM(cca.warehouse_name)) = ?
         )`,
      [warehouse, whLower]
    );

    const clients = new Set();
    (assignRows || []).forEach((row) => {
      const name = String(row.chamber_name || '');
      const m = name.match(/^Chamber\s+(\d+)$/i);
      const num = m
        ? parseInt(m[1], 10)
        : (() => {
            const any = name.match(/(\d+)/);
            return any ? parseInt(any[1], 10) : null;
          })();
      if (num != null && num > limit) return;
      const client = String(row.client_name || '').trim().toLowerCase();
      if (client && client !== 'general') clients.add(client);
    });

    if (clients.size > 0) {
      const byClient = filtered.filter((r) =>
        clients.has(String(r.client_name || '').trim().toLowerCase())
      );
      // Keep client filter only when it still returns data; else keep warehouse-scoped rows
      if (byClient.length > 0) filtered = byClient;
    }
  } catch (err) {
    console.warn('DO inventory client scope skipped:', err.message);
  }

  return filtered;
}

/**
 * GET DASHBOARD STATS SUMMARY
 * Calculates totals, status breakdown, and total revenue pipeline.
 */
exports.getDashboardStats = async (req, res) => {
  try {
    // 1. Total count of all leads
    const [totalRows] = await db.query('SELECT COUNT(*) as totalLeads FROM leads');
    
    // 2. Count leads by status
    const [newRows] = await db.query('SELECT COUNT(*) as newLeads FROM leads WHERE status = "New"');
    const [inProgressRows] = await db.query('SELECT COUNT(*) as inProgressLeads FROM leads WHERE status = "In Progress"');
    const [wonRows] = await db.query('SELECT COUNT(*) as wonLeads FROM leads WHERE status = "Won"');

    // 3. Calculate total pipeline value (INR)
    const [valueRows] = await db.query('SELECT SUM(value) as totalValue FROM leads');

    // 4. Customers and operators count
    let totalCustomers = 0;
    try {
      const [subRows] = await db.query('SELECT COUNT(*) as totalCustomers FROM customers');
      totalCustomers = subRows[0].totalCustomers || 0;
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        const [subRows] = await db.query('SELECT COUNT(*) as totalCustomers FROM sub_admins');
        totalCustomers = subRows[0].totalCustomers || 0;
      } else {
        throw err;
      }
    }
    const [operatorRows] = await db.query('SELECT COUNT(*) as totalOperators FROM do_operators');

    // 5. Calculate Overdue chamber inspections for the past 5 days
    let overdueCount = 0;
    try {
      // Fetch all active assignments
      const [assignments] = await db.query(`
        SELECT a.chamber_id, a.client_name, c.name as chamber_name 
        FROM chamber_client_assignments a 
        JOIN chambers c ON a.chamber_id = c.id
      `);

      // Generate dates for the past 5 days
      const pastDates = [];
      for (let i = 1; i <= 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        pastDates.push(d.toISOString().split('T')[0]);
      }

      if (assignments.length > 0 && pastDates.length > 0) {
        // Fetch all logs in the past 5 days
        const [pastLogs] = await db.query(
          'SELECT entry_date, client_name, chamber_name FROM daily_chamber_temp_logs WHERE entry_date IN (?)',
          [pastDates]
        );

        // Normalize database dates to YYYY-MM-DD strings for fast lookup
        const logMap = {};
        pastLogs.forEach(log => {
          if (!log.entry_date) return;
          let dateStr = log.entry_date;
          if (log.entry_date instanceof Date) {
            dateStr = log.entry_date.toISOString().split('T')[0];
          } else {
            dateStr = String(log.entry_date).split('T')[0];
          }
          const key = `${dateStr}_${log.chamber_name}_${log.client_name}`.toLowerCase();
          logMap[key] = true;
        });

        // Check which dates/assignments are missing logs
        pastDates.forEach(date => {
          assignments.forEach(item => {
            const key = `${date}_${item.chamber_name}_${item.client_name}`.toLowerCase();
            if (!logMap[key]) {
              overdueCount++;
            }
          });
        });
      }
    } catch (dbErr) {
      console.warn('⚠️ Overdue calculations query failed or table not found:', dbErr.message);
    }

    return res.status(200).json({
      success: true,
      stats: {
        totalLeads: totalRows[0].totalLeads || 0,
        newLeads: newRows[0].newLeads || 0,
        inProgressLeads: inProgressRows[0].inProgressLeads || 0,
        wonLeads: wonRows[0].wonLeads || 0,
        totalValue: parseFloat(valueRows[0].totalValue || 0),
        totalSubAdmins: totalCustomers,
        totalCustomers,
        totalOperators: operatorRows[0].totalOperators || 0,
        overdueInspections: overdueCount
      }
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'getDashboardStats',
      req,
      clientMessage: 'Server error while calculating dashboard statistics.'
    });
  }
};

/**
 * GET DISTINCT CLIENTS & WAREHOUSES (for Customer access scope selection)
 * Includes every client name that has saved data (logs + master assignments),
 * even after the Data Operator account is deleted.
 */
exports.getAccessScopeOptions = async (req, res) => {
  try {
    const clientSet = new Set();
    const warehouseSet = new Set();
    const warehouseClients = new Map(); // warehouse -> Set(client)

    const addWarehouseClient = (warehouse, client) => {
      const wh = warehouse != null ? String(warehouse).trim() : '';
      const cl = client != null ? String(client).trim() : '';
      if (!wh || !cl) return;
      if (!warehouseClients.has(wh)) warehouseClients.set(wh, new Set());
      warehouseClients.get(wh).add(cl);
      warehouseSet.add(wh);
      clientSet.add(cl);
    };

    const clientQueries = [
      // Clients added to chambers in Master Setup (DB assignments) — include even if inactive / DO deleted
      `SELECT DISTINCT cca.client_name AS name
       FROM chamber_client_assignments cca
       INNER JOIN chambers c ON c.id = cca.chamber_id
       WHERE cca.client_name IS NOT NULL AND TRIM(cca.client_name) != ''`,
      // Fallback if join fails older DBs: assignments without requiring chamber row
      `SELECT DISTINCT client_name AS name FROM chamber_client_assignments WHERE client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT client_name AS name FROM daily_chamber_temp_logs WHERE client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT inward_client_name AS name FROM inward_temp_logs WHERE inward_client_name IS NOT NULL AND TRIM(inward_client_name) != ''`,
      `SELECT DISTINCT outward_client_name AS name FROM outward_temp_logs WHERE outward_client_name IS NOT NULL AND TRIM(outward_client_name) != ''`,
      `SELECT DISTINCT client_name AS name FROM daily_temp_logs WHERE client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT client_name AS name FROM leads WHERE client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT client_name AS name FROM inward_outward_logs WHERE client_name IS NOT NULL AND TRIM(client_name) != ''`
    ];

    for (const sql of clientQueries) {
      try {
        const [rows] = await db.query(sql);
        rows.forEach((row) => {
          if (row.name) clientSet.add(String(row.name).trim());
        });
      } catch (tableErr) {
        console.warn('Access scope client query skipped:', tableErr.message);
      }
    }

    const warehouseQueries = [
      `SELECT DISTINCT warehouse_name AS name FROM daily_chamber_temp_logs WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`,
      `SELECT DISTINCT warehouse_name AS name FROM inward_temp_logs WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`,
      `SELECT DISTINCT warehouse_name AS name FROM outward_temp_logs WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`,
      `SELECT DISTINCT warehouse_name AS name FROM daily_temp_logs WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`,
      `SELECT DISTINCT warehouse_name AS name FROM do_operators WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`,
      `SELECT DISTINCT warehouse_name AS name FROM chamber_client_assignments WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`
    ];

    for (const sql of warehouseQueries) {
      try {
        const [rows] = await db.query(sql);
        rows.forEach((row) => {
          if (row.name) warehouseSet.add(String(row.name).trim());
        });
      } catch (tableErr) {
        console.warn('Access scope warehouse query skipped:', tableErr.message);
      }
    }

    // Warehouse → client pairs (for cascading Customer client dropdown)
    const pairQueries = [
      `SELECT DISTINCT warehouse_name, client_name
       FROM chamber_client_assignments
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT warehouse_name, client_name
       FROM daily_chamber_temp_logs
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT warehouse_name, inward_client_name AS client_name
       FROM inward_temp_logs
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND inward_client_name IS NOT NULL AND TRIM(inward_client_name) != ''`,
      `SELECT DISTINCT warehouse_name, outward_client_name AS client_name
       FROM outward_temp_logs
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND outward_client_name IS NOT NULL AND TRIM(outward_client_name) != ''`,
      // DO warehouse + chamber assignment clients (via chambers.warehouse_name if present)
      `SELECT DISTINCT COALESCE(cca.warehouse_name, c.warehouse_name, op.warehouse_name) AS warehouse_name,
              cca.client_name AS client_name
       FROM chamber_client_assignments cca
       LEFT JOIN chambers c ON c.id = cca.chamber_id
       LEFT JOIN do_operators op ON LOWER(TRIM(op.email)) = LOWER(TRIM(c.operator_email))
       WHERE cca.client_name IS NOT NULL AND TRIM(cca.client_name) != ''`
    ];

    for (const sql of pairQueries) {
      try {
        const [rows] = await db.query(sql);
        rows.forEach((row) => addWarehouseClient(row.warehouse_name, row.client_name));
      } catch (tableErr) {
        console.warn('Access scope warehouse-client pair query skipped:', tableErr.message);
      }
    }

    // Case-insensitive unique display names (prefer first-seen casing)
    const uniqueClients = [];
    const seenClients = new Set();
    [...clientSet]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .forEach((name) => {
        const key = name.toLowerCase();
        if (seenClients.has(key)) return;
        seenClients.add(key);
        uniqueClients.push(name);
      });

    const warehouses = [...warehouseSet].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const warehouseClientMap = {};
    [...warehouseClients.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
      .forEach(([wh, clients]) => {
        const unique = [];
        const seen = new Set();
        [...clients]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
          .forEach((name) => {
            const key = name.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            unique.push(name);
          });
        warehouseClientMap[wh] = unique;
      });

    return res.json({
      clients: uniqueClients,
      warehouses,
      warehouseClients: warehouseClientMap
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'getAccessScopeOptions',
      req,
      clientMessage: 'Failed to fetch options.'
    });
  }
};

/**
 * Live warehouse → client filter options from DB (assignments + logs + operators).
 * Used by Daily Box Inventory Tracker cascading filters.
 */
exports.getInventoryFilterOptions = async (req, res) => {
  try {
    const warehouseClients = new Map(); // warehouse -> Set(client)

    const addPair = (warehouse, client) => {
      const wh = warehouse != null ? String(warehouse).trim() : '';
      const cl = client != null ? String(client).trim() : '';
      if (!wh) return;
      if (!warehouseClients.has(wh)) warehouseClients.set(wh, new Set());
      if (cl) warehouseClients.get(wh).add(cl);
    };

    const pairQueries = [
      `SELECT DISTINCT warehouse_name, client_name
       FROM chamber_client_assignments
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND client_name IS NOT NULL AND TRIM(client_name) != ''
         AND (status IS NULL OR status = 'active')`,
      `SELECT DISTINCT warehouse_name, client_name
       FROM daily_chamber_temp_logs
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT warehouse_name, inward_client_name AS client_name
       FROM inward_temp_logs
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND inward_client_name IS NOT NULL AND TRIM(inward_client_name) != ''`,
      `SELECT DISTINCT warehouse_name, outward_client_name AS client_name
       FROM outward_temp_logs
       WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''
         AND outward_client_name IS NOT NULL AND TRIM(outward_client_name) != ''`
    ];

    for (const sql of pairQueries) {
      try {
        const [rows] = await db.query(sql);
        rows.forEach((row) => addPair(row.warehouse_name, row.client_name));
      } catch (tableErr) {
        console.warn('Inventory filter pair query skipped:', tableErr.message);
      }
    }

    // Warehouses configured on DO operators (even if no client rows yet)
    try {
      const [opRows] = await db.query(
        `SELECT DISTINCT warehouse_name
         FROM do_operators
         WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`
      );
      opRows.forEach((row) => addPair(row.warehouse_name, null));
    } catch (opErr) {
      console.warn('Inventory filter operator warehouse query skipped:', opErr.message);
    }

    const warehouses = Array.from(warehouseClients.entries())
      .map(([name, clientSet]) => {
        const clients = Array.from(clientSet).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        return {
          name,
          client_count: clients.length,
          clients
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const allClients = new Set();
    warehouses.forEach((w) => w.clients.forEach((c) => allClients.add(c)));

    return res.status(200).json({
      success: true,
      total_warehouses: warehouses.length,
      total_clients: allClients.size,
      warehouses
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'getInventoryFilterOptions',
      req,
      clientMessage: 'Server error while loading live warehouse/client filters.'
    });
  }
};

/**
 * GET INVENTORY RECONCILIATION LOG
 * Calculates inward, outward, and daily audit counts with discrepancies.
 */
exports.getInventoryReconciliation = async (req, res) => {
  try {
    const { search, warehouse } = req.query;

    const sql = `
      SELECT 
        cw.client_name,
        cw.warehouse_name,
        COALESCE(i.total_inward, 0) AS total_inward_boxes,
        COALESCE(o.total_outward, 0) AS total_outward_boxes,
        GREATEST(0, COALESCE(i.total_inward, 0) - COALESCE(o.total_outward, 0)) AS calculated_balance,
        COALESCE(d.last_box_count, 0) AS physical_audit_count,
        d.last_audit_date,
        d.chamber_name,
        (GREATEST(0, COALESCE(i.total_inward, 0) - COALESCE(o.total_outward, 0)) - COALESCE(d.last_box_count, 0)) AS discrepancy
      FROM (
        SELECT DISTINCT client_name, warehouse_name FROM (
          SELECT client_name, warehouse_name FROM daily_chamber_temp_logs WHERE client_name IS NOT NULL AND TRIM(client_name) != ''
          UNION
          SELECT inward_client_name AS client_name, warehouse_name FROM inward_temp_logs WHERE inward_client_name IS NOT NULL AND TRIM(inward_client_name) != ''
          UNION
          SELECT outward_client_name AS client_name, warehouse_name FROM outward_temp_logs WHERE outward_client_name IS NOT NULL AND TRIM(outward_client_name) != ''
        ) u
      ) cw
      LEFT JOIN (
        SELECT inward_client_name, warehouse_name, SUM(inward_received_boxes_qty) AS total_inward
        FROM inward_temp_logs
        GROUP BY inward_client_name, warehouse_name
      ) i ON cw.client_name = i.inward_client_name AND (cw.warehouse_name = i.warehouse_name OR (cw.warehouse_name IS NULL AND i.warehouse_name IS NULL))
      LEFT JOIN (
        SELECT outward_client_name, warehouse_name, SUM(outward_received_boxes_qty) AS total_outward
        FROM outward_temp_logs
        GROUP BY outward_client_name, warehouse_name
      ) o ON cw.client_name = o.outward_client_name AND (cw.warehouse_name = o.warehouse_name OR (cw.warehouse_name IS NULL AND o.warehouse_name IS NULL))
      LEFT JOIN (
        SELECT d1.client_name, d1.warehouse_name, d1.box_count AS last_box_count,
               d1.entry_date AS last_audit_date, d1.chamber_name
        FROM daily_chamber_temp_logs d1
        INNER JOIN (
          SELECT t.client_name, t.warehouse_name, MAX(t.id) AS max_id
          FROM daily_chamber_temp_logs t
          INNER JOIN (
            SELECT client_name, warehouse_name, MAX(entry_date) AS max_date
            FROM daily_chamber_temp_logs
            GROUP BY client_name, warehouse_name
          ) latest
            ON t.client_name = latest.client_name
           AND (
             t.warehouse_name = latest.warehouse_name
             OR (t.warehouse_name IS NULL AND latest.warehouse_name IS NULL)
           )
           AND t.entry_date = latest.max_date
          GROUP BY t.client_name, t.warehouse_name
        ) pick ON d1.id = pick.max_id
      ) d ON cw.client_name = d.client_name AND (cw.warehouse_name = d.warehouse_name OR (cw.warehouse_name IS NULL AND d.warehouse_name IS NULL))
    `;

    const [rows] = await db.query(sql);

    // One lot per client + warehouse (never Morning + Evening as two lots)
    const lotMap = new Map();
    for (const r of rows || []) {
      const key = `${String(r.client_name || '')
        .trim()
        .toLowerCase()}|||${String(r.warehouse_name || '')
        .trim()
        .toLowerCase()}`;
      if (!lotMap.has(key)) lotMap.set(key, r);
    }
    let filteredRows = Array.from(lotMap.values());

    // Customer portal: only assigned clients / warehouses
    filteredRows = applyCustomerInventoryScope(filteredRows, req.user);
    // DO portal: warehouse + assigned clients (chamber_limit aware)
    filteredRows = await applyDoInventoryScope(filteredRows, req.user);

    if (warehouse && warehouse !== 'All') {
      const warehouseLower = warehouse.toLowerCase().trim();
      filteredRows = filteredRows.filter(r => r.warehouse_name && r.warehouse_name.toLowerCase().trim() === warehouseLower);
    }

    const clientFilter = req.query.client;
    if (clientFilter && clientFilter !== 'All') {
      const clientLower = String(clientFilter).toLowerCase().trim();
      filteredRows = filteredRows.filter(
        (r) => r.client_name && r.client_name.toLowerCase().trim() === clientLower
      );
    }

    if (search && search.trim() !== '') {
      const searchLower = search.toLowerCase().trim();
      filteredRows = filteredRows.filter(r => 
        (r.client_name && r.client_name.toLowerCase().includes(searchLower)) ||
        (r.warehouse_name && r.warehouse_name.toLowerCase().includes(searchLower)) ||
        (r.chamber_name && r.chamber_name.toLowerCase().includes(searchLower))
      );
    }

    return res.status(200).json({
      success: true,
      items: filteredRows
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'getInventoryReconciliation',
      req,
      clientMessage: 'Server error while calculating inventory logs.'
    });
  }
};

/**
 * GET DAILY INVENTORY DELTAS
 * Compares the latest two box counts for each client/chamber combination.
 */
exports.getDailyInventoryDeltas = async (req, res) => {
  try {
    const { warehouse, fromDate, toDate } = req.query;

    const parseTemp = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const normalizeShift = (row) => {
      const s = String(row.shift || '').trim();
      if (/^morning$/i.test(s)) return 'Morning';
      if (/^evening$/i.test(s)) return 'Evening';
      const t = String(row.inspection_time || '').trim();
      const tUp = t.toUpperCase();
      if (/^10:00\b/.test(t) || tUp === '10:00 AM') return 'Morning';
      if (/^16:00\b|^18:00\b/.test(t) || tUp.includes('04:00 PM') || tUp.includes('06:00 PM')) {
        return 'Evening';
      }
      const hm = t.match(/^(\d{1,2}):(\d{2})/);
      if (hm) {
        let h = parseInt(hm[1], 10);
        if (tUp.includes('PM') && h < 12) h += 12;
        if (tUp.includes('AM') && h === 12) h = 0;
        return h < 14 ? 'Morning' : 'Evening';
      }
      if (row.created_at) {
        const d = new Date(row.created_at);
        if (!Number.isNaN(d.getTime())) return d.getHours() < 14 ? 'Morning' : 'Evening';
      }
      return 'Morning';
    };

    let sql = `
      SELECT
        id,
        DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date,
        client_name,
        chamber_name,
        warehouse_name,
        box_count,
        box_temp,
        box_temp AS chamber_temp,
        shift,
        inspection_time,
        created_at
      FROM daily_chamber_temp_logs
      WHERE client_name IS NOT NULL AND TRIM(client_name) != ''
    `;
    const params = [];
    if (warehouse && warehouse !== 'All') {
      sql += ` AND LOWER(TRIM(warehouse_name)) = LOWER(TRIM(?)) `;
      params.push(warehouse);
    }
    sql += ` ORDER BY entry_date DESC, id DESC `;

    const [rows] = await db.query(sql, params);

    // Group logs by client + chamber + warehouse
    const groups = {};
    rows.forEach(row => {
      const key = `${row.client_name}|||${row.chamber_name || ''}|||${row.warehouse_name || ''}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      const shiftLabel = normalizeShift(row);
      const dateShiftKey = `${row.entry_date}|||${shiftLabel}`;
      // Keep Morning + Evening for same date (unique by date+slot)
      if (!groups[key].some(item => item._dateShiftKey === dateShiftKey)) {
        groups[key].push({ ...row, shift: shiftLabel, _dateShiftKey: dateShiftKey });
      }
    });

    const deltas = [];
    Object.keys(groups).forEach(key => {
      const parts = key.split('|||');
      const client_name = parts[0];
      const chamber_name = parts[1];
      const warehouse_name = parts[2];
      const groupLogs = groups[key]; // Sorted descending (newest first)

      if (groupLogs.length > 0) {
        // Find the index of the first log that falls within the selected date range
        let indexOfLatest = -1;
        for (let i = 0; i < groupLogs.length; i++) {
          const entryDate = groupLogs[i].entry_date;
          let inRange = true;
          if (fromDate && entryDate < fromDate) inRange = false;
          if (toDate && entryDate > toDate) inRange = false;

          if (inRange) {
            indexOfLatest = i;
            break;
          }
        }

        // If a date range was selected and no audit falls inside it, skip this client/chamber
        if ((fromDate || toDate) && indexOfLatest === -1) {
          return;
        }

        // If no filter is matched, indexOfLatest is simply 0 (latest log of all time)
        if (indexOfLatest === -1) {
          indexOfLatest = 0;
        }

        const latest = groupLogs[indexOfLatest];
        const prev = indexOfLatest + 1 < groupLogs.length ? groupLogs[indexOfLatest + 1] : null;

        // Chamber box qty can never be negative
        const latest_count = Math.max(0, Number(latest.box_count) || 0);
        const prev_count = prev ? Math.max(0, Number(prev.box_count) || 0) : 0;
        const rawDelta = latest_count - prev_count;
        // Inward: prev 30 → latest 45 = +15 in | Outward: prev 30 → latest 12 = 18 out (qty never shown as negative)
        const inward_qty = rawDelta > 0 ? rawDelta : 0;
        const outward_qty = rawDelta < 0 ? Math.abs(rawDelta) : 0;
        const flow_type = rawDelta > 0 ? 'inward' : rawDelta < 0 ? 'outward' : 'no_change';

        // Retrieve audits based on selected calendar date filters, else full history (cap 50)
        let historyLogs = [];
        if (fromDate || toDate) {
          historyLogs = groupLogs.filter(g => {
            const entryDate = g.entry_date;
            if (fromDate && entryDate < fromDate) return false;
            if (toDate && entryDate > toDate) return false;
            return true;
          });
        } else {
          historyLogs = groupLogs.slice(0, 50);
        }

        const history = historyLogs
          .map(g => {
            const shift = g.shift || normalizeShift(g);
            const temp = parseTemp(g.box_temp ?? g.chamber_temp);
            const rawCount = g.box_count;
            const count = rawCount === null || rawCount === undefined || rawCount === ''
              ? null
              : Math.max(0, Number(rawCount) || 0);
            return {
              id: g.id,
              date: g.entry_date,
              entry_date: g.entry_date,
              shift,
              slot: shift,
              inspection_time: g.inspection_time || null,
              box_count: count,
              count,
              box_temp: temp,
              temp,
              chamber_temp: temp,
              chamber_name: g.chamber_name || null,
              warehouse_name: g.warehouse_name || null
            };
          })
          // Newest first: date DESC, Evening before Morning same day, then id DESC
          .sort((a, b) => {
            const da = String(a.date || '');
            const db = String(b.date || '');
            if (db !== da) return db.localeCompare(da);
            const sa = a.shift === 'Evening' ? 1 : 0;
            const sb = b.shift === 'Evening' ? 1 : 0;
            if (sb !== sa) return sb - sa;
            return (Number(b.id) || 0) - (Number(a.id) || 0);
          });

        const latest_temp = parseTemp(latest.box_temp ?? latest.chamber_temp);
        const prev_temp = prev ? parseTemp(prev.box_temp ?? prev.chamber_temp) : null;
        const latest_shift = latest.shift || normalizeShift(latest);
        const prev_shift = prev ? (prev.shift || normalizeShift(prev)) : null;

        deltas.push({
          client_name,
          chamber_name: chamber_name || '-',
          warehouse_name: warehouse_name || '-',
          latest_date: latest.entry_date,
          latest_count,
          latest_temp,
          latest_shift,
          latest_slot: latest_shift,
          box_temp: latest_temp,
          prev_date: prev ? prev.entry_date : null,
          prev_count,
          prev_temp,
          prev_shift,
          prev_slot: prev_shift,
          delta: rawDelta,
          inward_qty,
          outward_qty,
          flow_type,
          history
        });
      }
    });

    // Latest updates first
    deltas.sort((a, b) => {
      const da = String(a.latest_date || '');
      const dbDate = String(b.latest_date || '');
      if (dbDate !== da) return dbDate.localeCompare(da);
      return String(a.client_name || '').localeCompare(String(b.client_name || ''));
    });

    return res.status(200).json({
      success: true,
      items: deltas
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'getDailyInventoryDeltas',
      req,
      clientMessage: 'Server error while calculating daily inventory deltas.'
    });
  }
};

/**
 * GET DO TASK OVERVIEW (warehouse-wise)
 * For Sub-Admin / Super Admin mobile home:
 * DO names, today completed / pending, overdue (past 5 days).
 */
exports.getDoTaskOverview = async (req, res) => {
  try {
    const pad = (n) => String(n).padStart(2, '0');
    const toYmd = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // Prefer India local "today" (pool timezone is +05:30; Date here is server local)
    const now = new Date();
    const todayStr = toYmd(now);
    const hour = now.getHours();
    const expectedShifts = hour >= 16 ? ['Morning', 'Evening'] : ['Morning'];

    const pastDates = [];
    for (let i = 1; i <= 5; i += 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      pastDates.push(toYmd(d));
    }

    const [operators] = await db.query(
      `SELECT id, email, full_name, warehouse_name, chamber_limit
       FROM do_operators
       ORDER BY warehouse_name ASC, full_name ASC`
    );

    const [assignments] = await db.query(`
      SELECT
        a.chamber_id,
        a.client_name,
        a.warehouse_name AS assignment_warehouse,
        c.name AS chamber_name
      FROM chamber_client_assignments a
      JOIN chambers c ON c.id = a.chamber_id
      WHERE a.status = 'active'
        AND a.client_name IS NOT NULL
        AND TRIM(a.client_name) <> ''
        AND LOWER(TRIM(a.client_name)) <> 'general'
    `);

    const dateList = [todayStr, ...pastDates];
    const [logs] = await db.query(
      `SELECT
         DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date,
         client_name,
         chamber_name,
         chamber_id,
         warehouse_name,
         shift,
         inspection_time
       FROM daily_chamber_temp_logs
       WHERE entry_date IN (?)`,
      [dateList]
    );

    const normalizeShift = (row) => {
      const s = String(row.shift || '').trim();
      if (/^morning$/i.test(s)) return 'Morning';
      if (/^evening$/i.test(s)) return 'Evening';
      const t = String(row.inspection_time || '').trim().toUpperCase();
      if (t.startsWith('16:') || t.startsWith('18:') || t.includes('04:00 PM') || t.includes('06:00 PM')) {
        return 'Evening';
      }
      return 'Morning';
    };

    const normalizeWh = (v) => {
      const s = String(v || '').trim();
      return s || 'Unassigned';
    };

    const logKey = (date, chamber, client, shift) =>
      `${date}|${String(chamber || '').trim().toLowerCase()}|${String(client || '').trim().toLowerCase()}|${shift}`;

    const dayClientKey = (date, chamber, client) =>
      `${date}|${String(chamber || '').trim().toLowerCase()}|${String(client || '').trim().toLowerCase()}`;

    const todayLogSet = new Set();
    const pastLogSet = new Set();
    (logs || []).forEach((row) => {
      const date = String(row.entry_date || '').slice(0, 10);
      if (!date) return;
      const chamber = row.chamber_name;
      const client = row.client_name;
      if (date === todayStr) {
        todayLogSet.add(logKey(date, chamber, client, normalizeShift(row)));
      } else {
        pastLogSet.add(dayClientKey(date, chamber, client));
      }
    });

    const buckets = new Map();

    const ensureBucket = (warehouse) => {
      const key = normalizeWh(warehouse).toLowerCase();
      if (!buckets.has(key)) {
        buckets.set(key, {
          warehouse_name: normalizeWh(warehouse),
          operators: [],
          assignment_count: 0,
          completed: 0,
          pending: 0,
          overdue: 0,
          expected_today: 0,
          morning_pending: 0,
          evening_pending: 0
        });
      }
      return buckets.get(key);
    };

    (operators || []).forEach((op) => {
      const bucket = ensureBucket(op.warehouse_name);
      bucket.operators.push({
        id: op.id,
        name: op.full_name || op.email?.split('@')[0] || 'DO',
        email: op.email,
        chamber_limit: op.chamber_limit
      });
    });

    (assignments || []).forEach((a) => {
      const warehouse = a.assignment_warehouse || 'Unassigned';
      const bucket = ensureBucket(warehouse);
      bucket.assignment_count += 1;

      expectedShifts.forEach((shift) => {
        bucket.expected_today += 1;
        const done = todayLogSet.has(
          logKey(todayStr, a.chamber_name, a.client_name, shift)
        );
        if (done) {
          bucket.completed += 1;
        } else {
          bucket.pending += 1;
          if (shift === 'Morning') bucket.morning_pending += 1;
          if (shift === 'Evening') bucket.evening_pending += 1;
        }
      });

      pastDates.forEach((date) => {
        if (!pastLogSet.has(dayClientKey(date, a.chamber_name, a.client_name))) {
          bucket.overdue += 1;
        }
      });
    });

    const warehouses = Array.from(buckets.values())
      .map((w) => ({
        ...w,
        do_names: w.operators.map((o) => o.name).join(', ') || 'No DO assigned',
        status:
          w.pending === 0 && w.overdue === 0
            ? 'On track'
            : w.overdue > 0
              ? 'Needs attention'
              : 'In progress'
      }))
      .sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name));

    const summary = warehouses.reduce(
      (acc, w) => {
        acc.warehouses += 1;
        acc.operators += w.operators.length;
        acc.clients += Number(w.assignment_count) || 0;
        acc.completed += w.completed;
        acc.pending += w.pending;
        acc.overdue += w.overdue;
        return acc;
      },
      { warehouses: 0, operators: 0, clients: 0, completed: 0, pending: 0, overdue: 0 }
    );

    return res.status(200).json({
      success: true,
      today: todayStr,
      expected_shifts: expectedShifts,
      summary,
      warehouses
    });
  } catch (error) {
    return handleControllerError(res, error, {
      checkpoint: 'getDoTaskOverview',
      req,
      clientMessage: 'Server error while building DO task overview.'
    });
  }
};
