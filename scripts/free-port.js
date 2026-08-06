/**
 * Frees TCP port (default 5000) before server start.
 * Usage: node scripts/free-port.js [port]
 */
const { execSync } = require('child_process');
const port = Number(process.argv[2] || process.env.PORT || 5000);

function freePortWindows(p) {
  let out = '';
  try {
    out = execSync(`netstat -ano | findstr :${p}`, { encoding: 'utf8' });
  } catch {
    return;
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes('LISTENING')) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`[free-port] Freed port ${p} (killed PID ${pid})`);
    } catch {
      // ignore
    }
  }
}

function freePortUnix(p) {
  try {
    const out = execSync(`lsof -ti tcp:${p}`, { encoding: 'utf8' }).trim();
    if (!out) return;
    for (const pid of out.split(/\n/)) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        console.log(`[free-port] Freed port ${p} (killed PID ${pid})`);
      } catch {
        // ignore
      }
    }
  } catch {
    // nothing listening
  }
}

if (process.platform === 'win32') freePortWindows(port);
else freePortUnix(port);
