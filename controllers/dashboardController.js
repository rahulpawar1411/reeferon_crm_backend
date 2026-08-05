// ====================================================================
// Dashboard Controller (controllers/dashboardController.js)
// Computes summary metrics for mobile dashboard cards.
// ====================================================================

const db = require('../config/db');

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

    // 4. Sub admins and operators count
    const [subRows] = await db.query('SELECT COUNT(*) as totalSubAdmins FROM sub_admins');
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
        totalSubAdmins: subRows[0].totalSubAdmins || 0,
        totalOperators: operatorRows[0].totalOperators || 0,
        overdueInspections: overdueCount
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while calculating dashboard statistics.',
      error: error.message
    });
  }
};

/**
 * GET DISTINCT CLIENTS & WAREHOUSES (for Sub-Admin access scope selection)
 */
exports.getAccessScopeOptions = async (req, res) => {
  try {
    const clientSet = new Set();
    const warehouseSet = new Set();

    const clientQueries = [
      `SELECT DISTINCT client_name AS name FROM daily_chamber_temp_logs WHERE client_name IS NOT NULL AND TRIM(client_name) != ''`,
      `SELECT DISTINCT inward_client_name AS name FROM inward_temp_logs WHERE inward_client_name IS NOT NULL AND TRIM(inward_client_name) != ''`,
      `SELECT DISTINCT outward_client_name AS name FROM outward_temp_logs WHERE outward_client_name IS NOT NULL AND TRIM(outward_client_name) != ''`,
      `SELECT DISTINCT client_name AS name FROM daily_temp_logs WHERE client_name IS NOT NULL AND TRIM(client_name) != ''`
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
      `SELECT DISTINCT warehouse_name AS name FROM daily_temp_logs WHERE warehouse_name IS NOT NULL AND TRIM(warehouse_name) != ''`
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

    const clients = [...clientSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const warehouses = [...warehouseSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    return res.json({ clients, warehouses });
  } catch (error) {
    console.error('Error fetching access scope options:', error);
    return res.status(500).json({ error: 'Failed to fetch options.' });
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
        (COALESCE(i.total_inward, 0) - COALESCE(o.total_outward, 0)) AS calculated_balance,
        COALESCE(d.last_box_count, 0) AS physical_audit_count,
        d.last_audit_date,
        d.chamber_name,
        ((COALESCE(i.total_inward, 0) - COALESCE(o.total_outward, 0)) - COALESCE(d.last_box_count, 0)) AS discrepancy
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
        SELECT d1.client_name, d1.warehouse_name, d1.box_count AS last_box_count, d1.entry_date AS last_audit_date, d1.chamber_name
        FROM daily_chamber_temp_logs d1
        INNER JOIN (
          SELECT client_name, warehouse_name, MAX(entry_date) AS max_date
          FROM daily_chamber_temp_logs
          GROUP BY client_name, warehouse_name
        ) d2 ON d1.client_name = d2.client_name AND (d1.warehouse_name = d2.warehouse_name OR (d1.warehouse_name IS NULL AND d2.warehouse_name IS NULL)) AND d1.entry_date = d2.max_date
      ) d ON cw.client_name = d.client_name AND (cw.warehouse_name = d.warehouse_name OR (cw.warehouse_name IS NULL AND d.warehouse_name IS NULL))
    `;

    const [rows] = await db.query(sql);

    // Filter results in JavaScript for maximum safety and flexibility
    let filteredRows = rows;

    if (warehouse && warehouse !== 'All') {
      const warehouseLower = warehouse.toLowerCase().trim();
      filteredRows = filteredRows.filter(r => r.warehouse_name && r.warehouse_name.toLowerCase().trim() === warehouseLower);
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
    console.error('Error fetching inventory reconciliation logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while calculating inventory logs.',
      error: error.message
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
    let sql = `
      SELECT id, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, client_name, chamber_name, warehouse_name, box_count 
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
      // Only keep unique dates per group
      if (!groups[key].some(item => item.entry_date === row.entry_date)) {
        groups[key].push(row);
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

        const latest_count = latest.box_count || 0;
        const prev_count = prev ? (prev.box_count || 0) : 0;

        // Retrieve audits based on selected calendar date filters, else fallback to last 5
        let historyLogs = [];
        if (fromDate || toDate) {
          historyLogs = groupLogs.filter(g => {
            const entryDate = g.entry_date;
            if (fromDate && entryDate < fromDate) return false;
            if (toDate && entryDate > toDate) return false;
            return true;
          });
        } else {
          historyLogs = groupLogs.slice(0, 5);
        }

        const history = historyLogs
          .map(g => ({
            date: g.entry_date,
            count: g.box_count || 0
          }))
          .reverse();

        deltas.push({
          client_name,
          chamber_name: chamber_name || '-',
          warehouse_name: warehouse_name || '-',
          latest_date: latest.entry_date,
          latest_count: latest_count,
          prev_date: prev ? prev.entry_date : null,
          prev_count: prev_count,
          delta: latest_count - prev_count,
          history: history
        });
      }
    });

    return res.status(200).json({
      success: true,
      items: deltas
    });
  } catch (error) {
    console.error('Error fetching daily inventory deltas:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while calculating daily inventory deltas.',
      error: error.message
    });
  }
};
