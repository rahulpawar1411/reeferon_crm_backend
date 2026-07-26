const db = require('../config/db');

exports.getActivityLogs = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, operator_email, action, log_type, description, created_at FROM do_operator_activities ORDER BY id DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching activity logs:', err);
    return res.status(500).json({ error: 'Failed to fetch operator activity logs.' });
  }
};
