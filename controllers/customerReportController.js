// ====================================================================
// Customer Report Controller
// Sub Admin submits issues; Super Admin reviews with full customer identity
// Table: customer_reports
// ====================================================================

const db = require('../config/db');
const { logActivity } = require('../utils/logger');
const { handleControllerError } = require('../utils/errorHandler');

const ALLOWED_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];

async function loadCustomerIdentity(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  const [rows] = await db.query(
    `SELECT id, email, full_name, phone_no, allowed_clients, allowed_warehouses
     FROM sub_admins WHERE email = ? LIMIT 1`,
    [clean]
  );
  return rows[0] || null;
}

/** POST / — Sub Admin creates a report */
exports.createCustomerReport = async (req, res) => {
  try {
    if (req.user?.role !== 'sub_admin' && req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only customers can submit reports.' });
    }

    const reference_no = String(req.body.reference_no || '').trim();
    const message = String(req.body.message || '').trim();
    const email = (req.user?.email || '').trim().toLowerCase() || 'unknown';

    if (!reference_no) {
      return res.status(400).json({ error: 'Please enter the Reference No. of the log.' });
    }
    if (!message) {
      return res.status(400).json({ error: 'Please type your issue in the message box.' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Issue message is too long (max 4000 characters).' });
    }

    const profile = await loadCustomerIdentity(email);
    const customer_id = profile?.id || null;
    const customer_name = profile?.full_name || req.user?.full_name || null;
    const customer_phone = profile?.phone_no || null;
    const allowed_clients = profile?.allowed_clients || null;
    const allowed_warehouses = profile?.allowed_warehouses || null;

    const [result] = await db.query(
      `INSERT INTO customer_reports
        (customer_id, customer_email, customer_name, customer_phone, allowed_clients, allowed_warehouses, reference_no, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open')`,
      [
        customer_id,
        email,
        customer_name,
        customer_phone,
        allowed_clients,
        allowed_warehouses,
        reference_no,
        message
      ]
    );

    await logActivity(
      email,
      'CUSTOMER_REPORT',
      'SYSTEM',
      `Customer report #${result.insertId} by ${customer_name || email} (ID: ${customer_id || 'n/a'}) for Ref ${reference_no}: ${message.slice(0, 220)}`
    );

    return res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Your report has been submitted. Our team will review it.'
    });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'createCustomerReport',
      req,
      clientMessage: 'Failed to submit report. Please try again.'
    });
  }
};

/** GET / — Super Admin lists all customer reports */
exports.getCustomerReports = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only Super Admin can view customer reports.' });
    }

    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();
    const conditions = [];
    const params = [];

    if (status && status !== 'All' && ALLOWED_STATUSES.includes(status)) {
      conditions.push('r.status = ?');
      params.push(status);
    }
    if (search) {
      const q = `%${search}%`;
      conditions.push(`(
        r.reference_no LIKE ? OR r.message LIKE ? OR r.customer_email LIKE ?
        OR r.customer_name LIKE ? OR r.customer_phone LIKE ?
        OR CAST(r.customer_id AS CHAR) LIKE ? OR r.allowed_clients LIKE ?
      )`);
      params.push(q, q, q, q, q, q, q);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT
         r.id,
         r.customer_id,
         r.customer_email,
         r.customer_name,
         r.customer_phone,
         r.allowed_clients,
         r.allowed_warehouses,
         r.reference_no,
         r.message,
         r.status,
         r.reviewed_by_email,
         r.created_at,
         r.updated_at,
         r.resolved_at,
         sa.full_name AS live_customer_name,
         sa.phone_no AS live_customer_phone,
         sa.allowed_clients AS live_allowed_clients,
         sa.allowed_warehouses AS live_allowed_warehouses
       FROM customer_reports r
       LEFT JOIN sub_admins sa ON sa.email = r.customer_email
       ${where}
       ORDER BY
         CASE r.status
           WHEN 'Open' THEN 0
           WHEN 'In Progress' THEN 1
           WHEN 'Resolved' THEN 2
           ELSE 3
         END,
         r.created_at DESC`,
      params
    );

    const reports = (rows || []).map((row) => ({
      id: row.id,
      customer_id: row.customer_id || null,
      customer_email: row.customer_email,
      customer_name: row.live_customer_name || row.customer_name || null,
      customer_phone: row.live_customer_phone || row.customer_phone || null,
      allowed_clients: row.live_allowed_clients || row.allowed_clients || null,
      allowed_warehouses: row.live_allowed_warehouses || row.allowed_warehouses || null,
      reference_no: row.reference_no,
      message: row.message,
      status: row.status || 'Open',
      reviewed_by_email: row.reviewed_by_email || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      resolved_at: row.resolved_at
    }));

    return res.json(reports);
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'getCustomerReports',
      req,
      clientMessage: 'Failed to fetch customer reports.'
    });
  }
};

/** PATCH /:id/status — Super Admin updates report status */
exports.updateCustomerReportStatus = async (req, res) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only Super Admin can update report status.' });
    }

    const { id } = req.params;
    const status = String(req.body.status || '').trim();
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const reviewer = req.user?.email || 'super_admin';
    const resolvedAt = status === 'Resolved' || status === 'Closed' ? new Date() : null;

    const [result] = await db.query(
      `UPDATE customer_reports
       SET status = ?, reviewed_by_email = ?, resolved_at = ?
       WHERE id = ?`,
      [status, reviewer, resolvedAt, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    await logActivity(
      reviewer,
      'CUSTOMER_REPORT_STATUS',
      'SYSTEM',
      `Super Admin set customer report #${id} to ${status}`
    );

    return res.json({ success: true, message: `Report marked as ${status}.` });
  } catch (err) {
    return handleControllerError(res, err, {
      checkpoint: 'updateCustomerReportStatus',
      req,
      clientMessage: 'Failed to update report status.'
    });
  }
};
