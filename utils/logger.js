const db = require('../config/db');

exports.logActivity = async (email, action, logType, description) => {
  try {
    await db.query(
      'INSERT INTO do_operator_activities (operator_email, action, log_type, description) VALUES (?, ?, ?, ?)',
      [email || 'system', action, logType, description]
    );
  } catch (err) {
    console.error('Failed to write operator activity log:', err);
  }
};
