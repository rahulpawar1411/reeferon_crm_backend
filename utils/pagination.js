/**
 * Shared list pagination for large log tables.
 */
function parsePagination(query, options = {}) {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;
  const exportMax = options.exportMax ?? 2000;
  const isExport = query.export === '1' || query.export === 'true';
  const cap = isExport ? exportMax : maxLimit;

  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  let limit = parseInt(String(query.limit || String(defaultLimit)), 10) || defaultLimit;
  limit = Math.min(Math.max(1, limit), cap);
  const offset = (page - 1) * limit;

  return { page, limit, offset, isExport };
}

function sendPaginated(res, items, total, page, limit) {
  const totalNum = Number(total) || 0;
  return res.json({
    items: items || [],
    total: totalNum,
    page,
    limit,
    hasMore: page * limit < totalNum
  });
}

/** Super Admin history: filter by warehouse query (?warehouse=Name or Generic). */
function appendWarehouseFilter(conditions, params, query, user) {
  const warehouse = query.warehouse;
  if (!warehouse || warehouse === 'All') return;
  if (!user || user.role !== 'super_admin') return;
  if (warehouse === 'Generic') {
    conditions.push('(warehouse_name IS NULL OR warehouse_name = ? OR warehouse_name = \'\')');
    params.push('Generic');
  } else {
    conditions.push('warehouse_name = ?');
    params.push(warehouse);
  }
}

module.exports = { parsePagination, sendPaginated, appendWarehouseFilter };
