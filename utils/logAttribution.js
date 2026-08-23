/**
 * Resolve warehouse + operator for log records.
 * Prefer authenticated user (JWT) values; fall back to explicit body fields when missing.
 */
function resolveLogAttribution(req, body = {}) {
  const warehouse =
    (req.user && req.user.warehouse_name) ||
    body.warehouse_name ||
    null;
  const warehouseCode =
    (req.user && req.user.warehouse_code) ||
    body.warehouse_code ||
    null;
  const operatorEmail =
    (req.user && req.user.email) ||
    body.operator_email ||
    null;

  return {
    warehouse_name: warehouse ? String(warehouse).trim() : null,
    warehouse_code: warehouseCode ? String(warehouseCode).trim() : null,
    operator_email: operatorEmail ? String(operatorEmail).trim().toLowerCase() : null
  };
}

module.exports = { resolveLogAttribution };
