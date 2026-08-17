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

function parseCsvNames(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Customer access scope from assigned client / warehouse names (case-insensitive).
 * - Clients only → filter by client_name
 * - Warehouses only → filter by warehouse_name (NULL/empty also allowed)
 * - Both → client match AND (warehouse match OR warehouse missing on log)
 * Accepts legacy role `sub_admin` as customer.
 */
function appendSubAdminAccessScope(conditions, params, user, options = {}) {
  const role = user?.role === 'sub_admin' ? 'customer' : user?.role;
  if (!user || role !== 'customer') return;

  const clientColumn = options.clientColumn || 'client_name';
  const warehouseColumn = options.warehouseColumn || 'warehouse_name';

  const clients = parseCsvNames(user.allowed_clients).map((c) => c.toLowerCase());
  const warehouses = parseCsvNames(user.allowed_warehouses).map((w) => w.toLowerCase());

  if (clients.length > 0) {
    const placeholders = clients.map(() => '?').join(', ');
    conditions.push(`LOWER(TRIM(COALESCE(${clientColumn}, ''))) IN (${placeholders})`);
    params.push(...clients);
  }

  if (warehouses.length > 0) {
    const placeholders = warehouses.map(() => '?').join(', ');
    conditions.push(
      `(${warehouseColumn} IS NULL OR TRIM(COALESCE(${warehouseColumn}, '')) = '' OR LOWER(TRIM(${warehouseColumn})) IN (${placeholders}))`
    );
    params.push(...warehouses);
  }
}

/** Optional warehouse filter for Super Admin / Customer list views. */
function appendWarehouseFilter(conditions, params, query, user) {
  const warehouse = query.warehouse;
  if (!warehouse || warehouse === 'All') return;
  const role = user?.role === 'sub_admin' ? 'customer' : user?.role;
  if (!user || (role !== 'super_admin' && role !== 'customer')) return;
  if (warehouse === 'Generic') {
    conditions.push(`(warehouse_name IS NULL OR TRIM(COALESCE(warehouse_name, '')) = '' OR LOWER(TRIM(warehouse_name)) = ?)`);
    params.push('generic');
  } else {
    conditions.push('LOWER(TRIM(COALESCE(warehouse_name, \'\'))) = ?');
    params.push(String(warehouse).trim().toLowerCase());
  }
}

/** Optional client filter (SA / Customer / DO). */
function appendClientFilter(conditions, params, query, user) {
  const client = query.client;
  if (!client || client === 'All') return;
  const role = user?.role === 'sub_admin' ? 'customer' : user?.role;
  if (!user || (role !== 'super_admin' && role !== 'customer' && role !== 'do_operator')) return;
  conditions.push('LOWER(TRIM(COALESCE(client_name, \'\'))) = ?');
  params.push(String(client).trim().toLowerCase());
}

/** Optional chamber filter so same client on two chambers does not mix. */
function appendChamberFilter(conditions, params, query) {
  const chamberId = query.chamber_id;
  if (chamberId != null && String(chamberId).trim() !== '' && String(chamberId).toLowerCase() !== 'all') {
    const id = parseInt(chamberId, 10);
    if (Number.isFinite(id)) {
      conditions.push('chamber_id = ?');
      params.push(id);
      return;
    }
  }
  const chamber = query.chamber || query.chamber_name;
  if (!chamber || chamber === 'All') return;
  conditions.push('LOWER(TRIM(COALESCE(chamber_name, \'\'))) = ?');
  params.push(String(chamber).trim().toLowerCase());
}

module.exports = {
  parsePagination,
  sendPaginated,
  parseCsvNames,
  appendSubAdminAccessScope,
  appendWarehouseFilter,
  appendClientFilter,
  appendChamberFilter
};
