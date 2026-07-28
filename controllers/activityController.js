const db = require('../config/db');
const { handleControllerError } = require('../utils/errorHandler');

exports.getActivityLogs = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, operator_email, action, log_type, description, permission_req, created_at FROM do_operator_activities ORDER BY id DESC'
    );
    return res.json(rows);
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getActivityLogs',
      req,
      clientMessage: 'Failed to fetch operator activity logs.'
    });
  }
};
