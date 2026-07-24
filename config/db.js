// ====================================================================
// Database Connection Configuration (config/db.js)
// Uses mysql2 connection pooling for safe, high-performance DB queries.
// ====================================================================

const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Create a connection pool (Reuses DB connections automatically)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'reeferon_crm_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Helper function to test DB connection when backend starts
async function testDbConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL Database:', process.env.DB_NAME || 'reeferon_crm_db');
    connection.release(); // Release connection back to pool
  } catch (error) {
    console.warn('⚠️ Warning: MySQL database connection failed:', error.message);
    console.warn('💡 Tip: Ensure MySQL is running on port 3306 and reeferon_crm_db exists.');
  }
}

// Run connection check once when file is required
testDbConnection();

module.exports = pool;
