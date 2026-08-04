const db = require('../config/db');
const { handleControllerError } = require('../utils/errorHandler');
const { parsePagination, sendPaginated } = require('../utils/pagination');

/**
 * Paginated operator activity / security / system logs.
 * Query: page, limit, export, search, fromDate, toDate, action, category, warehouse
 * category: activity | security | system (default activity)
 */
exports.getActivityLogs = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const {
      search,
      fromDate,
      toDate,
      action,
      category = 'activity',
      warehouse
    } = req.query;

    const conditions = [];
    const params = [];

    const cat = String(category || 'activity').toLowerCase();
    if (cat === 'security') {
      conditions.push(`(a.log_type IN ('PERMISSION', 'SECURITY'))`);
    } else if (cat === 'system') {
      conditions.push(`(
        a.log_type IN ('SYSTEM', 'ERROR')
        OR a.action = 'SYSTEM_ERROR'
        OR (a.description IS NOT NULL AND a.description LIKE '%[CHECKPOINT]%')
      )`);
    } else if (cat === 'do_changes') {
      conditions.push(`(a.action IN ('ADD_CLIENT', 'DELETE_CLIENT', 'UPDATE_CLIENT', 'ADD_CHAMBER', 'DELETE_CHAMBER'))`);
    } else {
      // Operator activity trail (exclude security / system / error rows AND exclude do_changes to keep general activity clean)
      conditions.push(`(
        (a.log_type IS NULL OR a.log_type NOT IN ('PERMISSION', 'SECURITY', 'ERROR', 'SYSTEM'))
        AND (a.action IS NULL OR a.action NOT IN ('SYSTEM_ERROR', 'ADD_CLIENT', 'DELETE_CLIENT', 'UPDATE_CLIENT', 'ADD_CHAMBER', 'DELETE_CHAMBER'))
      )`);
    }

    if (action && action !== 'All') {
      conditions.push('a.action = ?');
      params.push(String(action));
    }

    if (fromDate) {
      conditions.push('DATE(a.created_at) >= ?');
      params.push(String(fromDate));
    }
    if (toDate) {
      conditions.push('DATE(a.created_at) <= ?');
      params.push(String(toDate));
    }

    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      conditions.push(`(
        a.operator_email LIKE ?
        OR a.description LIKE ?
        OR a.action LIKE ?
        OR a.log_type LIKE ?
        OR op.full_name LIKE ?
      )`);
      params.push(q, q, q, q, q);
    }

    // Warehouse filter (activity tab only; matches prior UI behaviour)
    if (cat === 'activity' && warehouse && warehouse !== 'All') {
      if (warehouse === 'System/Admin') {
        conditions.push(`(op.warehouse_name IS NULL OR op.warehouse_name = '')`);
      } else {
        conditions.push(`(op.warehouse_name IS NULL OR op.warehouse_name = '' OR op.warehouse_name = ?)`);
        params.push(String(warehouse));
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const fromJoin = `
      FROM do_operator_activities a
      LEFT JOIN do_operators op
        ON LOWER(TRIM(op.email)) = LOWER(TRIM(a.operator_email))
    `;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total ${fromJoin} ${whereClause}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    const [rows] = await db.query(
      `SELECT
        a.id,
        a.operator_email,
        a.action,
        a.log_type,
        a.description,
        a.permission_req,
        a.created_at
      ${fromJoin}
      ${whereClause}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return sendPaginated(res, rows, total, page, limit);
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getActivityLogs',
      req,
      clientMessage: 'Failed to fetch operator activity logs.'
    });
  }
};

exports.createActivityLog = async (req, res) => {
  try {
    const { action, log_type = 'activity', description } = req.body;
    if (!action || !description) {
      return res.status(400).json({ success: false, message: 'Action and Description are required.' });
    }
    const email = req.user ? req.user.email : 'system';
    
    await db.query(
      'INSERT INTO do_operator_activities (operator_email, action, log_type, description) VALUES (?, ?, ?, ?)',
      [email, action, log_type, description]
    );

    return res.status(201).json({ success: true, message: 'Activity log recorded successfully.' });
  } catch (error) {
    console.error('Failed to create activity log:', error);
    return res.status(500).json({ success: false, message: 'Failed to record activity log.', error: error.message });
  }
};
