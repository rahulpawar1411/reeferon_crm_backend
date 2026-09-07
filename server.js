// ====================================================================
// Express API Server Main Entry (backend/server.js)
// Port: 5000 | MySQL Connection Pool | Static Uploads Folder
// ====================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const {
  enableQuietConsole,
  serverRunning,
  statusLine,
  errorLine
} = require('./utils/quietConsole');

// Quiet terminal: only server running + errors + status codes
enableQuietConsole();

const app = express();
const PORT = process.env.PORT || 5000;

// Security Header Protection (Helmet)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS Configuration with Credentials Support (Required for HttpOnly Cookies)
const allowedOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5000'];
if (process.env.FRONTEND_URL) {
  const origins = process.env.FRONTEND_URL.split(',').map(url => url.trim());
  allowedOrigins.push(...origins);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser / same-origin / Vite LAN hosts during local dev
    if (!origin || allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

// Compact HTTP status log (4xx/5xx always; all statuses if LOG_ALL_STATUS=1)
app.use((req, res, next) => {
  res.on('finish', () => {
    const code = res.statusCode;
    const logAll = process.env.LOG_ALL_STATUS === '1';
    if (logAll || code >= 400) {
      statusLine(req.method, req.originalUrl, code);
    }
  });
  next();
});

// Log failed HTTP responses to backend/logs (error.log + daily file)
// 5xx → logErrorCheckpoint (file + DB). 4xx (except 401/403) → file only.
app.use((req, res, next) => {
  const originalJson = res.json;

  res.json = function (body) {
    try {
      const code = res.statusCode;
      const alreadyLogged = res.locals && res.locals.errorCheckpointLogged;

      if (!alreadyLogged && code >= 500) {
        const { logErrorCheckpoint } = require('./utils/errorHandler');
        const errMsg = body?.error || body?.message || 'Unknown server error';
        const synthetic = new Error(typeof errMsg === 'string' ? errMsg : 'Unknown server error');
        synthetic.name = body?.checkpoint?.type || 'HttpError';
        synthetic.statusCode = code;
        res.locals = res.locals || {};
        res.locals.errorCheckpointLogged = true;
        logErrorCheckpoint(synthetic, {
          checkpoint: body?.checkpoint?.checkpoint || 'httpResponseInterceptor',
          statusCode: code,
          method: req.method,
          url: req.originalUrl,
          email: req.user?.email || 'system',
          file: body?.checkpoint?.file || null,
          line: body?.checkpoint?.line || null
        }).catch((err) => {
          errorLine('Failed to log error response checkpoint:', err?.message || err);
        });
      } else if (!alreadyLogged && code >= 400 && code !== 401 && code !== 403) {
        // Client/business failures (validation, conflicts, not found, etc.)
        const { writeHttpFailure } = require('./utils/errorFileLogger');
        writeHttpFailure(req, code, body || {}, {
          process: body?.checkpoint?.checkpoint || 'httpResponseInterceptor'
        });
      }
    } catch (interceptErr) {
      errorLine('Error file logger interceptor failed:', interceptErr?.message || interceptErr);
    }
    return originalJson.apply(this, arguments);
  };

  next();
});

// Rate Limiter for Login Endpoint (Brute-force protection)
// Skipped on local dev so wrong-password testing does not block you for 15 minutes.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  skip: () => process.env.NODE_ENV !== 'production',
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Redirect static requests for Cloudinary URLs if the client prepended /
app.use((req, res, next) => {
  const match = req.originalUrl.match(/^\/+(https?:\/+.+)$/i);
  if (match) {
    let targetUrl = match[1];
    targetUrl = targetUrl.replace(/^(https?):\/+/, '$1://');
    return res.redirect(targetUrl);
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Missing upload files must 404 (not fall through to SPA HTML — breaks <img>)
app.use('/uploads', (req, res) => {
  res.status(404).type('text/plain').send('Upload not found');
});
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Public diagnostic debug endpoint to troubleshoot live sync failures
app.get('/api/debug-sync', async (req, res) => {
  const diagnostics = {};
  const dbPool = require('./config/db');
  
  // 1. Test Database Connectivity
  try {
    await dbPool.query('SELECT 1');
    diagnostics.database = { status: 'OK', connected: true };
  } catch (dbErr) {
    diagnostics.database = { status: 'ERROR', connected: false, message: dbErr.message };
  }

  // 2. Test Database Schema Integrity
  if (diagnostics.database.connected) {
    try {
      const [columns] = await dbPool.query('SHOW COLUMNS FROM daily_chamber_temp_logs');
      diagnostics.schema = {
        table_exists: true,
        columns: columns.map(c => c.Field)
      };
    } catch (schemaErr) {
      diagnostics.schema = {
        table_exists: false,
        message: schemaErr.message
      };
    }
  }

  // 3. Test Cloudinary Connectivity
  try {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
    const dummyBase64 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const uploadResult = await cloudinary.uploader.upload(dummyBase64, { folder: 'crm/debug' });
    diagnostics.cloudinary = {
      status: 'OK',
      public_id: uploadResult.public_id,
      url: uploadResult.secure_url,
      config: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        has_secret: !!process.env.CLOUDINARY_API_SECRET
      }
    };
  } catch (cloudErr) {
    diagnostics.cloudinary = {
      status: 'ERROR',
      message: cloudErr.message,
      config: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        has_secret: !!process.env.CLOUDINARY_API_SECRET
      }
    };
  }

  // 4. Fetch the last 5 system/upload error logs from the server
  if (diagnostics.database.connected) {
    try {
      const [logs] = await dbPool.query(
        "SELECT action, description, created_at FROM do_operator_activities WHERE action = 'SYSTEM_ERROR' OR log_type = 'ERROR' ORDER BY id DESC LIMIT 5"
      );
      diagnostics.recent_errors = logs;
    } catch (logErr) {
      diagnostics.recent_errors_error = logErr.message;
    }
  }

  return res.json(diagnostics);
});

const { verifyToken, requireRole } = require('./middleware/auth');

const authRoutes = require('./routes/authRoutes');
const leadRoutes = require('./routes/leadRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const tempRoutes = require('./routes/tempRoutes');
const chamberTempRoutes = require('./routes/chamberTempRoutes');
const inwardRoutes = require('./routes/inwardRoutes');
const outwardRoutes = require('./routes/outwardRoutes');
const operatorRoutes = require('./routes/operatorRoutes');
const subAdminRoutes = require('./routes/subAdminRoutes');
const activityRoutes = require('./routes/activityRoutes');
const permissionRoutes = require('./routes/permissionRoutes');
const chamberRoutes = require('./routes/chamberRoutes');
const masterRoutes = require('./routes/masterRoutes');

app.use('/api/auth/login', loginRateLimiter);
app.use('/api/auth', authRoutes);

app.use('/api/chambers', verifyToken, requireRole(['super_admin', 'customer', 'do_operator', 'sub_admin']), chamberRoutes);
app.use('/api/leads', verifyToken, requireRole(['super_admin', 'customer', 'sub_admin']), leadRoutes);
app.use('/api/dashboard', verifyToken, requireRole(['super_admin', 'customer', 'sub_admin', 'do_operator']), dashboardRoutes);
app.use('/api/temp-logs', verifyToken, requireRole(['super_admin', 'customer', 'do_operator', 'sub_admin']), tempRoutes);
app.use('/api/chamber-temp', verifyToken, requireRole(['super_admin', 'customer', 'do_operator', 'sub_admin']), chamberTempRoutes);
app.use('/api/inward-logs', verifyToken, requireRole(['super_admin', 'customer', 'do_operator', 'sub_admin']), inwardRoutes);
app.use('/api/outward-logs', verifyToken, requireRole(['super_admin', 'customer', 'do_operator', 'sub_admin']), outwardRoutes);
app.use('/api/do-operators', verifyToken, requireRole(['super_admin', 'sub_admin']), operatorRoutes);
app.use('/api/customers', verifyToken, requireRole(['super_admin']), subAdminRoutes);
app.use('/api/sub-admins', verifyToken, requireRole(['super_admin']), require('./routes/appSubAdminRoutes'));
app.use('/api/operator-activities', verifyToken, requireRole(['super_admin', 'customer', 'do_operator', 'sub_admin']), activityRoutes);
app.use('/api/permission-requests', permissionRoutes);
app.use('/api/masters', verifyToken, requireRole(['super_admin', 'sub_admin']), masterRoutes);
app.use(
  '/api/customer-reports',
  verifyToken,
  requireRole(['customer', 'super_admin']),
  require('./routes/customerReportRoutes')
);
app.use(
  '/api/customer-notes',
  verifyToken,
  requireRole(['customer', 'super_admin']),
  require('./routes/customerAdminNotesRoutes')
);

app.get('/api/health', async (req, res) => {
  const db = require('./config/db');
  const dbHealth = await db.getDbHealth();
  const ok = dbHealth.connected;
  const uptimeSeconds = Math.floor(process.uptime());

  return res.status(ok ? 200 : 503).json({
    success: ok,
    message: ok ? 'ReeferON CRM API running smoothly.' : 'API up but database unavailable.',
    data: {
      status: ok ? 'Online' : 'Degraded',
      database: ok ? 'connected' : 'disconnected',
      databaseError: dbHealth.error || null,
      uptimeSeconds,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    }
  });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      success: false,
      message: 'API route not found',
      error: 'API route not found'
    });
  }
  
  const frontendPath = path.join(__dirname, '../frontend/dist/index.html');
  if (fs.existsSync(frontendPath)) {
    res.sendFile(frontendPath);
  } else {
    res.json({
      status: 'Online',
      message: 'ReeferON CRM API Backend running smoothly. Frontend is served separately.'
    });
  }
});

app.use(require('./utils/errorHandler').globalErrorMiddleware);

// ------------------------------------------------------------------
// Process-level failures + log housekeeping on startup
// ------------------------------------------------------------------
const { ensureLogsDir, writeFailedProcess } = require('./utils/errorFileLogger');
const { archiveLegacyLogs } = require('./scripts/archive-error-logs');
ensureLogsDir();
try {
  const { moved } = archiveLegacyLogs();
  if (moved > 0) console.log(`📁 Archived ${moved} legacy text log file(s) → logs/archive/`);
} catch (archiveErr) {
  errorLine('Log archive skipped:', archiveErr?.message || archiveErr);
}

process.on('uncaughtException', (err) => {
  writeFailedProcess('uncaughtException', err, { status: 500 });
  errorLine('uncaughtException:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  writeFailedProcess('unhandledRejection', err, { status: 500 });
  errorLine('unhandledRejection:', err?.message || err);
});

const db = require('./config/db');
let httpServer;

httpServer = app.listen(PORT, async () => {
  serverRunning(PORT);
  const health = await db.getDbHealth();
  if (!health.connected) {
    errorLine('Database not connected at startup:', health.error || 'unknown');
  }
});

/** Graceful shutdown — finish in-flight requests before exit. */
function gracefulShutdown(signal) {
  errorLine(`${signal} received — shutting down…`);
  httpServer.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
