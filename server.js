// ====================================================================
// Express API Server Main Entry (backend/server.js)
// Port: 5000 | MySQL Connection Pool | Static Uploads Folder
// ====================================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve Uploads directory statically (e.g., http://localhost:5000/uploads/...)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
const leadRoutes = require('./routes/leadRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const tempRoutes = require('./routes/tempRoutes');
const chamberTempRoutes = require('./routes/chamberTempRoutes');
const inwardRoutes = require('./routes/inwardRoutes');

app.use('/api/leads', leadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/temp-logs', tempRoutes);
app.use('/api/chamber-temp', chamberTempRoutes);
app.use('/api/inward-logs', inwardRoutes);

// Root Health Check Route
app.get('/', (req, res) => {
  res.json({ status: 'Online', message: 'ReeferON CRM API Backend running smoothly.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 ReeferON CRM Server listening on port ${PORT}`);
});
