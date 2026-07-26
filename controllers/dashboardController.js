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
