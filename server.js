// ====================================================================
// Express API Server Main Entry (backend/server.js)
// Port: 5000 | MySQL Connection Pool | Static Uploads Folder
// ====================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
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
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5000'],
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

// Response Interceptor Middleware to log system/database errors to the DB automatically
app.use((req, res, next) => {
  const originalJson = res.json;

  res.json = function (body) {
    if (res.statusCode >= 500 && !(res.locals && res.locals.errorCheckpointLogged)) {
      const { logErrorCheckpoint } = require('./utils/errorHandler');
      const errMsg = body?.error || body?.message || JSON.stringify(body) || 'Unknown error';
      const synthetic = new Error(typeof errMsg === 'string' ? errMsg : 'Unknown server error');
      synthetic.name = body?.checkpoint?.type || 'HttpError';
      synthetic.statusCode = res.statusCode;
      logErrorCheckpoint(synthetic, {
        checkpoint: body?.checkpoint?.checkpoint || 'httpResponseInterceptor',
        statusCode: res.statusCode,
        method: req.method,
        url: req.originalUrl,
        email: req.user?.email || 'system',
        file: body?.checkpoint?.file || null,
        line: body?.checkpoint?.line || null
      }).catch((err) => {
        errorLine('Failed to log error response checkpoint:', err?.message || err);
      });
    }
    return originalJson.apply(this, arguments);
  };

  next();
});

// Rate Limiter for Login Endpoint (Brute-force protection)
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../frontend/dist')));

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

app.use('/api/auth/login', loginRateLimiter);
app.use('/api/auth', authRoutes);

app.use('/api/leads', verifyToken, requireRole(['super_admin', 'sub_admin']), leadRoutes);
app.use('/api/dashboard', verifyToken, requireRole(['super_admin', 'sub_admin']), dashboardRoutes);
app.use('/api/temp-logs', verifyToken, requireRole(['super_admin', 'sub_admin', 'do_operator']), tempRoutes);
app.use('/api/chamber-temp', verifyToken, requireRole(['super_admin', 'sub_admin', 'do_operator']), chamberTempRoutes);
app.use('/api/inward-logs', verifyToken, requireRole(['super_admin', 'sub_admin', 'do_operator']), inwardRoutes);
app.use('/api/outward-logs', verifyToken, requireRole(['super_admin', 'sub_admin', 'do_operator']), outwardRoutes);
app.use('/api/do-operators', verifyToken, requireRole(['super_admin']), operatorRoutes);
app.use('/api/sub-admins', verifyToken, requireRole(['super_admin']), subAdminRoutes);
app.use('/api/operator-activities', verifyToken, requireRole(['super_admin']), activityRoutes);
app.use('/api/permission-requests', permissionRoutes);
app.use(
  '/api/customer-reports',
  verifyToken,
  requireRole(['sub_admin', 'super_admin']),
  require('./routes/customerReportRoutes')
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'Online', message: 'ReeferON CRM API Backend running smoothly.' });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

app.use(require('./utils/errorHandler').globalErrorMiddleware);

app.listen(PORT, () => {
  serverRunning(PORT);
});
