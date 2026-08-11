// ====================================================================
// JWT Secret Helper (backend/utils/jwtSecret.js)
// --------------------------------------------------------------------
// WHY: Signing/verifying tokens must use ONE secret from backend/.env.
//      A hard-coded fallback is unsafe (anyone who knows the repo can forge tokens).
//
// SETUP:  JWT_SECRET=your-long-random-string   in backend/.env
// USAGE:  const { getJwtSecret } = require('../utils/jwtSecret');
//         jwt.sign(payload, getJwtSecret(), { expiresIn: '24h' });
//         jwt.verify(token, getJwtSecret());
// ====================================================================

/**
 * Returns process.env.JWT_SECRET (trimmed).
 * Throws ConfigError (statusCode 500) if missing — callers should map that to 503.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !String(secret).trim()) {
    const err = new Error(
      'JWT_SECRET is not configured. Set JWT_SECRET in backend/.env and restart the server.'
    );
    err.statusCode = 500;
    err.type = 'ConfigError';
    throw err;
  }
  return String(secret).trim();
}

module.exports = { getJwtSecret };
