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

    // Auto migration: create daily_temp_logs table if not exists
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_temp_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          entry_type VARCHAR(50) NOT NULL,
          container_number VARCHAR(50) NOT NULL,
          client_name VARCHAR(150) NOT NULL,
          cargo_type VARCHAR(100) DEFAULT 'Cold Cargo',
          target_temp DECIMAL(5,2) NOT NULL,
          actual_temp DECIMAL(5,2) NOT NULL,
          temp_variance DECIMAL(5,2) DEFAULT 0.0,
          status VARCHAR(50) DEFAULT 'Normal',
          location_dock VARCHAR(100) DEFAULT 'Bay 1',
          driver_name VARCHAR(100) DEFAULT NULL,
          driver_phone VARCHAR(50) DEFAULT NULL,
          seal_number VARCHAR(100) DEFAULT NULL,
          genset_status VARCHAR(50) DEFAULT 'Running',
          fuel_level VARCHAR(50) DEFAULT '100%',
          operator_name VARCHAR(150) DEFAULT NULL,
          remarks TEXT DEFAULT NULL,
          warehouse_name VARCHAR(150) DEFAULT NULL,
          operator_email VARCHAR(150) DEFAULT NULL,
          recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('🌱 Verified daily_temp_logs table is online.');
    } catch (tblErr) {
      console.warn('⚠️ Table daily_temp_logs creation failed:', tblErr.message);
    }

    // Auto migration: add warehouse_name column to log tables if they don't exist
    const logTables = ['daily_chamber_temp_logs', 'inward_temp_logs', 'outward_temp_logs', 'daily_temp_logs'];
    for (const table of logTables) {
      try {
        const [columns] = await pool.query(`SHOW COLUMNS FROM ${table}`);
        const colNames = columns.map(c => c.Field);
        if (!colNames.includes('warehouse_name')) {
          await pool.query(`ALTER TABLE ${table} ADD COLUMN warehouse_name VARCHAR(150) DEFAULT NULL`);
          console.log(`🌱 Added column warehouse_name to ${table}.`);
        }
        if (!colNames.includes('operator_email')) {
          await pool.query(`ALTER TABLE ${table} ADD COLUMN operator_email VARCHAR(150) DEFAULT NULL`);
          console.log(`🌱 Added column operator_email to ${table}.`);
        }
        if (!colNames.includes('update_details') && table !== 'daily_temp_logs') {
          await pool.query(`ALTER TABLE ${table} ADD COLUMN update_details TEXT DEFAULT NULL`);
          console.log(`🌱 Added column update_details to ${table}.`);
        }
      } catch (tblErr) {
        console.warn(`⚠️ Table ${table} verification skipped or failed:`, tblErr.message);
      }
    }

    // Auto migration: add reference_no column to inward_temp_logs, outward_temp_logs and daily_chamber_temp_logs
    const tablesForRef = ['inward_temp_logs', 'outward_temp_logs', 'daily_chamber_temp_logs'];
    for (const table of tablesForRef) {
      try {
        const [columns] = await pool.query(`SHOW COLUMNS FROM ${table}`);
        const colNames = columns.map(c => c.Field);
        if (!colNames.includes('reference_no')) {
          await pool.query(`ALTER TABLE ${table} ADD COLUMN reference_no VARCHAR(50) DEFAULT NULL`);
          console.log(`🌱 Added column reference_no to ${table}.`);
        }
      } catch (tblErr) {
        console.warn(`⚠️ Table ${table} reference_no verification failed:`, tblErr.message);
      }
    }

    // Backfill existing rows with formatted reference numbers
    try {
      await pool.query(`
        UPDATE inward_temp_logs 
        SET reference_no = CONCAT('RF-IN-26-', LPAD(inward_id, 4, '0')) 
        WHERE reference_no IS NULL
      `);
      console.log('🌱 Populated reference_no for existing inward logs.');
    } catch (err) {
      console.warn('⚠️ Failed to populate reference_no for inward logs:', err.message);
    }

    try {
      await pool.query(`
        UPDATE outward_temp_logs 
        SET reference_no = CONCAT('RF-OUT-26-', LPAD(outward_id, 4, '0')) 
        WHERE reference_no IS NULL
      `);
      console.log('🌱 Populated reference_no for existing outward logs.');
    } catch (err) {
      console.warn('⚠️ Failed to populate reference_no for outward logs:', err.message);
    }

    try {
      await pool.query(`
        UPDATE daily_chamber_temp_logs 
        SET reference_no = CONCAT('RF-CH-26-', LPAD(id, 4, '0')) 
        WHERE reference_no IS NULL
      `);
      console.log('🌱 Populated reference_no for existing daily chamber logs.');
    } catch (err) {
      console.warn('⚠️ Failed to populate reference_no for daily chamber logs:', err.message);
    }

    // Auto migration: add outward_pre_vehicle_temp column to outward_temp_logs if they don't exist
    try {
      const [columns] = await pool.query('SHOW COLUMNS FROM outward_temp_logs');
      const colNames = columns.map(c => c.Field);
      if (!colNames.includes('outward_pre_vehicle_temp')) {
        await pool.query('ALTER TABLE outward_temp_logs ADD COLUMN outward_pre_vehicle_temp DECIMAL(5,2) DEFAULT NULL');
        console.log('🌱 Added column outward_pre_vehicle_temp to outward_temp_logs.');
      }
      if (!colNames.includes('outward_pre_vehicle_temp_photo')) {
        await pool.query('ALTER TABLE outward_temp_logs ADD COLUMN outward_pre_vehicle_temp_photo VARCHAR(255) DEFAULT NULL');
        console.log('🌱 Added column outward_pre_vehicle_temp_photo to outward_temp_logs.');
      }
    } catch (tblErr) {
      console.warn('⚠️ Table outward_temp_logs columns verification failed:', tblErr.message);
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
          permission_req INT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('🌱 Verified do_operator_activities table is online.');

      // Check and add permission_req dynamically if table already exists
      const [columns] = await pool.query('SHOW COLUMNS FROM do_operator_activities');
      const colNames = columns.map(c => c.Field);
      if (!colNames.includes('permission_req')) {
        await pool.query('ALTER TABLE do_operator_activities ADD COLUMN permission_req INT DEFAULT NULL');
      }

      // Clean up deprecated do_permission_requests table if it exists
      await pool.query('DROP TABLE IF EXISTS do_permission_requests');
      console.log('🌱 Dropped deprecated do_permission_requests table.');
    } catch (actErr) {
      console.warn('⚠️ Table do_operator_activities verification failed:', actErr.message);
    }

    // Auto migration: create leads table if not exists
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS leads (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(150) NOT NULL,
          company VARCHAR(150) DEFAULT NULL,
          email VARCHAR(100) DEFAULT NULL,
          phone VARCHAR(20) NOT NULL,
          status VARCHAR(50) DEFAULT 'New',
          source VARCHAR(100) DEFAULT 'Direct',
          value DECIMAL(10,2) DEFAULT 0.00,
          notes TEXT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('🌱 Verified leads table is online.');
    } catch (leadsErr) {
      console.warn('⚠️ Table leads creation failed:', leadsErr.message);
    }

    // Auto migration: create daily_chamber_temp_logs table if not exists
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_chamber_temp_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          entry_date DATE NOT NULL,
          client_name VARCHAR(150) NOT NULL,
          chamber_name VARCHAR(100) NOT NULL,
          inspection_time VARCHAR(50) NOT NULL,
          chamber_temp DECIMAL(4,1) NOT NULL,
          monitor_supervisor_name VARCHAR(150) NOT NULL,
          temp_sensor_image VARCHAR(255) DEFAULT NULL,
          photo_capture_time VARCHAR(50) DEFAULT NULL,
          time_variance_minutes INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          warehouse_name VARCHAR(150) DEFAULT NULL,
          operator_email VARCHAR(150) DEFAULT NULL
        )
      `);
      console.log('🌱 Verified daily_chamber_temp_logs table is online.');
    } catch (chamberErr) {
      console.warn('⚠️ Table daily_chamber_temp_logs creation failed:', chamberErr.message);
    }

    // Log successful server startup process
    try {
      await pool.query(
        'INSERT INTO do_operator_activities (operator_email, action, log_type, description) VALUES (?, ?, ?, ?)',
        ['system', 'SERVER_STARTUP', 'SYSTEM', 'ReeferON CRM API Backend server initialized. Database connections, auto-migrations, and table schemas verified successfully.']
      );
    } catch (logErr) {
      console.warn('⚠️ Failed to write server startup log:', logErr.message);
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
