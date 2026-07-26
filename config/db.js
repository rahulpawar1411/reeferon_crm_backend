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
    
    // Auto migration: add columns to do_operators table if they don't exist
    try {
      const [columns] = await pool.query('SHOW COLUMNS FROM do_operators');
      const colNames = columns.map(c => c.Field);
      
      if (!colNames.includes('full_name')) {
        await pool.query('ALTER TABLE do_operators ADD COLUMN full_name VARCHAR(150) DEFAULT NULL');
        console.log('🌱 Added column full_name to do_operators.');
      }
      if (!colNames.includes('phone_no')) {
        await pool.query('ALTER TABLE do_operators ADD COLUMN phone_no VARCHAR(50) DEFAULT NULL');
        console.log('🌱 Added column phone_no to do_operators.');
      }
      if (!colNames.includes('warehouse_name')) {
        await pool.query('ALTER TABLE do_operators ADD COLUMN warehouse_name VARCHAR(150) DEFAULT NULL');
        console.log('🌱 Added column warehouse_name to do_operators.');
      }
    } catch (tblErr) {
      console.warn('⚠️ Table do_operators verification skipped:', tblErr.message);
    }

    // Auto migration: create do_operator_activities table if not exists
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS do_operator_activities (
          id INT AUTO_INCREMENT PRIMARY KEY,
          operator_email VARCHAR(150) NOT NULL,
          action VARCHAR(50) NOT NULL,
          log_type VARCHAR(50) NOT NULL,
          description TEXT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('🌱 Verified do_operator_activities table is online.');
    } catch (actErr) {
      console.warn('⚠️ Table do_operator_activities verification failed:', actErr.message);
    }

    connection.release(); // Release connection back to pool
  } catch (error) {
    console.warn('⚠️ Warning: MySQL database connection failed:', error.message);
    console.warn('💡 Tip: Ensure MySQL is running on port 3306 and reeferon_crm_db exists.');
  }
}

// Run connection check once when file is required
testDbConnection();

module.exports = pool;
