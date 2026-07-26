const db = require('../config/db');

exports.logActivity = async (email, action, logType, description, permissionReqId = null) => {
  try {
    await db.query(
      'INSERT INTO do_operator_activities (operator_email, action, log_type, description, permission_req) VALUES (?, ?, ?, ?, ?)',
      [email || 'system', action, logType, description, permissionReqId]
    );
  } catch (err) {
    console.error('Failed to write operator activity log:', err);
  }
};
