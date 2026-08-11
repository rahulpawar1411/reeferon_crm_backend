// ====================================================================
// Standard API JSON responses (backend/utils/apiResponse.js)
// --------------------------------------------------------------------
// Success: { success: true, message, data }
// Error:   { success: false, message, error, checkpoint? }
// ====================================================================

/**
 * @param {import('express').Response} res
 * @param {*} [data]
 * @param {string} [message]
 * @param {number} [status]
 */
function sendSuccess(res, data = null, message = 'OK', status = 200) {
  const body = { success: true, message };
  if (data !== null && data !== undefined) body.data = data;
  return res.status(status).json(body);
}

/**
 * @param {import('express').Response} res
 * @param {string} message
 * @param {number} [status]
 * @param {object} [extra] - checkpoint, details, etc.
 */
function sendError(res, message, status = 500, extra = {}) {
  return res.status(status).json({
    success: false,
    message,
    error: message,
    ...extra
  });
}

module.exports = { sendSuccess, sendError };
