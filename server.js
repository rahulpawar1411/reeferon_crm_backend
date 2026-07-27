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

const app = express();
const PORT = process.env.PORT || 5000;

// Security Header Protection (Helmet)
app.use(helmet({
  contentSecurityPolicy: false, // Disabled in dev/test to allow local image/font loading easily
  crossOriginEmbedderPolicy: false
}));

// CORS Configuration with Credentials Support (Required for HttpOnly Cookies)
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5000'], // Allowed frontend origins
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

// Response Interceptor Middleware to log system/database errors to the DB automatically
app.use((req, res, next) => {
  const originalJson = res.json;
  const originalSend = res.send;

  res.json = function (body) {
    if (res.statusCode >= 500) {
      const { logActivity } = require('./utils/logger');
      const email = req.user?.email || 'system';
      const errMsg = body?.error || body?.message || JSON.stringify(body) || 'Unknown error';
      logActivity(email, 'SYSTEM_ERROR', 'ERROR', `Error on ${req.method} ${req.originalUrl}: ${errMsg}`).catch(err => {
        console.error('Failed to log error response:', err);
      });
    }
    return originalJson.apply(this, arguments);
  };

  res.send = function (body) {
    if (res.statusCode >= 500) {
      const { logActivity } = require('./utils/logger');
      const email = req.user?.email || 'system';
      const errMsg = typeof body === 'string' ? body : JSON.stringify(body);
      logActivity(email, 'SYSTEM_ERROR', 'ERROR', `Error on ${req.method} ${req.originalUrl}: ${errMsg.substring(0, 500)}`).catch(err => {
        console.error('Failed to log error response:', err);
      });
    }
    return originalSend.apply(this, arguments);
  };

  next();
});


// Rate Limiter for Login Endpoint (Brute-force protection)
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 15, // Limit each IP to 15 login attempts per window
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Serve Uploads directory statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static built frontend files
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Import Middlewares
const { verifyToken, requireRole } = require('./middleware/auth');

// Import Routes
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

// Mount Authentication Routes with Limiter on Login
app.use('/api/auth', authRoutes);
app.post('/api/auth/login', loginRateLimiter); // Apply limiter specifically to login

// Protected Operational Routes (Role-Based Authorization)
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Online', message: 'ReeferON CRM API Backend running smoothly.' });
});

// Wildcard route to serve React app's index.html for any frontend routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Global unhandled error handling middleware boundary
app.use(async (err, req, res, next) => {
  console.error('❌ Unhandled Exception:', err);
  try {
    const { logActivity } = require('./utils/logger');
    const userEmail = req.user?.email || 'system';
    await logActivity(userEmail, 'SYSTEM_ERROR', 'ERROR', `Unhandled Exception: ${err.message}. Route: ${req.method} ${req.originalUrl}. Stack: ${err.stack?.substring(0, 300)}`);
  } catch (logErr) {
    console.error('Failed to log unhandled exception:', logErr);
  }
  res.status(500).json({ error: 'A system error occurred. Please contact support.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 ReeferON CRM Server listening on port ${PORT}`);
});
