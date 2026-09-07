/**
 * Smoke-test restored DB against app expectations (no password guessing).
 * Creates a short-lived JWT using backend JWT_SECRET to hit protected APIs.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const BASE = `http://127.0.0.1:${process.env.PORT || 5000}/api`;

async function getJson(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function main() {
  const token = jwt.sign(
    {
      id: 1,
      email: 'admin@reeferon.com',
      role: 'super_admin',
      full_name: 'Super Admin',
    },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );

  const checks = [
    ['/dashboard', 'Dashboard'],
    ['/do-operators', 'DO operators'],
    ['/customers', 'Customers'],
    ['/permission-requests', 'Permission requests'],
    ['/chambers', 'Chambers'],
  ];

  let failed = 0;
  for (const [path, label] of checks) {
    const { status, body } = await getJson(path, token);
    const ok = status >= 200 && status < 300;
    console.log(`${ok ? 'OK' : 'FAIL'} ${label} (${path}) → HTTP ${status}`);
    if (!ok) {
      failed += 1;
      const msg = typeof body === 'object' ? body.message || JSON.stringify(body).slice(0, 200) : String(body).slice(0, 200);
      console.log(`     ${msg}`);
    }
  }

  const loginBad = await getJson('/auth/login', null);
  const badRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@reeferon.com', password: '__wrong__' }),
  });
  const badBody = await badRes.json().catch(() => ({}));
  console.log(
    badRes.status === 401 ? 'OK' : 'FAIL',
    `Login rejects wrong password → HTTP ${badRes.status}`
  );
  if (badRes.status !== 401) failed += 1;

  const loginMissing = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-in-db@reeferon.com', password: 'x' }),
  });
  console.log(
    loginMissing.status === 401 ? 'OK' : 'FAIL',
    `Login rejects unknown email → HTTP ${loginMissing.status}`
  );
  if (loginMissing.status !== 401) failed += 1;

  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Smoke test failed:', e.message);
  process.exit(1);
});
