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

    return res.status(200).json({
      success: true,
      stats: {
        totalLeads: totalRows[0].totalLeads || 0,
        newLeads: newRows[0].newLeads || 0,
        inProgressLeads: inProgressRows[0].inProgressLeads || 0,
        wonLeads: wonRows[0].wonLeads || 0,
        totalValue: parseFloat(valueRows[0].totalValue || 0),
        totalSubAdmins: subRows[0].totalSubAdmins || 0,
        totalOperators: operatorRows[0].totalOperators || 0
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
