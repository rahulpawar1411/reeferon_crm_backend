// ====================================================================
// Quiet terminal logger — only server status, errors, and HTTP status codes
// ====================================================================

const orig = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
};

let quietEnabled = true;

function enableQuietConsole() {
  quietEnabled = true;

  console.log = (...args) => {
    if (!quietEnabled) return orig.log(...args);
    const msg = args.map(String).join(' ');
    // Allow explicit server-running lines only
    if (
      /server running/i.test(msg) ||
      /listening on/i.test(msg) ||
      /^\[STATUS\]/.test(msg)
    ) {
      orig.log(...args);
    }
  };

  console.warn = (...args) => {
    if (!quietEnabled) return orig.warn(...args);
    const msg = args.map(String).join(' ');
    // Surface real failures / connection problems
    if (
      /fail/i.test(msg) ||
      /error/i.test(msg) ||
      /unable/i.test(msg) ||
      /cannot/i.test(msg) ||
      /^\[ERROR\]/.test(msg) ||
      /^\[WARN\]/.test(msg)
    ) {
      orig.warn(...args);
    }
  };

  console.error = (...args) => {
    // Always show errors
    orig.error(...args);
  };
}

function disableQuietConsole() {
  quietEnabled = false;
  console.log = orig.log;
  console.warn = orig.warn;
  console.error = orig.error;
}

function serverRunning(port) {
  orig.log(`[SERVER] running on http://localhost:${port}`);
}

function statusLine(method, url, statusCode) {
  const tag = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'STATUS';
  const line = `[${tag}] ${statusCode} ${method} ${url}`;
  if (statusCode >= 400) orig.error(line);
  else orig.log(line);
}

function errorLine(message, extra) {
  if (extra !== undefined) orig.error(`[ERROR] ${message}`, extra);
  else orig.error(`[ERROR] ${message}`);
}

module.exports = {
  enableQuietConsole,
  disableQuietConsole,
  serverRunning,
  statusLine,
  errorLine,
  raw: orig
};
