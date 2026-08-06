// ====================================================================
// Database Connection Configuration (config/db.js)
// Uses mysql2 connection pooling for safe, high-performance DB queries.
// ====================================================================

const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

// Create a connection pool (Reuses DB connections automatically)
// Supports connection string (DATABASE_URL) or individual parameters
const pool = process.env.DATABASE_URL
  ? mysql.createPool(process.env.DATABASE_URL)
  : mysql.createPool({
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
      if (!colNames.includes('chamber_limit')) {
        await pool.query('ALTER TABLE do_operators ADD COLUMN chamber_limit INT DEFAULT 4');
        console.log('🌱 Added column chamber_limit to do_operators.');
      }
    } catch (tblErr) {
      console.warn('⚠️ Table do_operators verification skipped:', tblErr.message);
    }

    // Auto migration: ensure sub_admins table and profile / access scope columns exist
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sub_admins (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(150) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          full_name VARCHAR(150) DEFAULT NULL,
          phone_no VARCHAR(20) DEFAULT NULL,
          allowed_clients TEXT DEFAULT NULL,
          allowed_warehouses TEXT DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT NULL
        )
      `);

      const [subColumns] = await pool.query('SHOW COLUMNS FROM sub_admins');
      const subColNames = subColumns.map(c => c.Field);

      if (!subColNames.includes('full_name')) {
        await pool.query('ALTER TABLE sub_admins ADD COLUMN full_name VARCHAR(150) DEFAULT NULL');
        console.log('🌱 Added column full_name to sub_admins.');
      }
      if (!subColNames.includes('phone_no')) {
        await pool.query('ALTER TABLE sub_admins ADD COLUMN phone_no VARCHAR(20) DEFAULT NULL');
        console.log('🌱 Added column phone_no to sub_admins.');
      }
      if (!subColNames.includes('allowed_clients')) {
        await pool.query('ALTER TABLE sub_admins ADD COLUMN allowed_clients TEXT DEFAULT NULL');
        console.log('🌱 Added column allowed_clients to sub_admins.');
      }
      if (!subColNames.includes('allowed_warehouses')) {
        await pool.query('ALTER TABLE sub_admins ADD COLUMN allowed_warehouses TEXT DEFAULT NULL');
        console.log('🌱 Added column allowed_warehouses to sub_admins.');
      }
      if (!subColNames.includes('updated_at')) {
        await pool.query('ALTER TABLE sub_admins ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL');
        console.log('🌱 Added column updated_at to sub_admins.');
      }
      console.log('🌱 Verified sub_admins table schema.');
    } catch (subErr) {
      console.warn('⚠️ Table sub_admins verification skipped:', subErr.message);
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
        if (!colNames.includes('update_count') && table !== 'daily_temp_logs') {
          await pool.query(`ALTER TABLE ${table} ADD COLUMN update_count INT NOT NULL DEFAULT 0`);
          console.log(`🌱 Added column update_count to ${table}.`);
          // Legacy rows that already have edit history → count at least 1
          await pool.query(
            `UPDATE ${table} SET update_count = 1 WHERE update_details IS NOT NULL AND TRIM(update_details) <> '' AND (update_count IS NULL OR update_count = 0)`
          );
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
      if (!colNames.includes('do_action_completed_at')) {
        await pool.query(
          'ALTER TABLE do_operator_activities ADD COLUMN do_action_completed_at TIMESTAMP NULL DEFAULT NULL'
        );
        console.log('🌱 Added column do_action_completed_at to do_operator_activities.');
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

    // Auto migration: customer issue reports (dedicated table for customer portal)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS customer_reports (
          id INT AUTO_INCREMENT PRIMARY KEY,
          customer_id INT DEFAULT NULL,
          customer_email VARCHAR(150) NOT NULL,
          customer_name VARCHAR(150) DEFAULT NULL,
          customer_phone VARCHAR(20) DEFAULT NULL,
          allowed_clients TEXT DEFAULT NULL,
          allowed_warehouses TEXT DEFAULT NULL,
          reference_no VARCHAR(100) NOT NULL,
          message TEXT NOT NULL,
          status VARCHAR(50) DEFAULT 'Open',
          reviewed_by_email VARCHAR(150) DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT NULL,
          resolved_at TIMESTAMP NULL DEFAULT NULL,
          INDEX idx_customer_reports_ref (reference_no),
          INDEX idx_customer_reports_email (customer_email),
          INDEX idx_customer_reports_status (status),
          INDEX idx_customer_reports_customer_id (customer_id)
        )
      `);

      const [crCols] = await pool.query('SHOW COLUMNS FROM customer_reports');
      const crNames = crCols.map((c) => c.Field);
      const crAlters = [
        ['customer_id', 'ADD COLUMN customer_id INT DEFAULT NULL AFTER id'],
        ['customer_phone', 'ADD COLUMN customer_phone VARCHAR(20) DEFAULT NULL AFTER customer_name'],
        ['allowed_clients', 'ADD COLUMN allowed_clients TEXT DEFAULT NULL AFTER customer_phone'],
        ['allowed_warehouses', 'ADD COLUMN allowed_warehouses TEXT DEFAULT NULL AFTER allowed_clients'],
        ['reviewed_by_email', 'ADD COLUMN reviewed_by_email VARCHAR(150) DEFAULT NULL AFTER status'],
        ['updated_at', 'ADD COLUMN updated_at TIMESTAMP NULL DEFAULT NULL AFTER created_at'],
        ['resolved_at', 'ADD COLUMN resolved_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at']
      ];
      for (const [col, ddl] of crAlters) {
        if (!crNames.includes(col)) {
          await pool.query(`ALTER TABLE customer_reports ${ddl}`);
          console.log(`🌱 Added column ${col} to customer_reports.`);
        }
      }
      console.log('🌱 Verified customer_reports table is online.');
    } catch (reportErr) {
      console.warn('⚠️ Table customer_reports creation failed:', reportErr.message);
    }

    // Auto migration: create daily_chamber_temp_logs table if not exists
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_chamber_temp_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          entry_date DATE NOT NULL,
          client_name VARCHAR(150) NOT NULL,
          chamber_name VARCHAR(100) NOT NULL,
          chamber_id INT DEFAULT NULL,
          inspection_time VARCHAR(50) NOT NULL,
          box_temp DECIMAL(4,1) NOT NULL,
          monitor_supervisor_name VARCHAR(150) NOT NULL,
          temp_sensor_image VARCHAR(255) DEFAULT NULL,
          photo_capture_time VARCHAR(50) DEFAULT NULL,
          time_variance_minutes INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NULL DEFAULT NULL,
          warehouse_name VARCHAR(150) DEFAULT NULL,
          operator_email VARCHAR(150) DEFAULT NULL,
          chamber_type VARCHAR(50) DEFAULT 'Frozen',
          overdue_time VARCHAR(100) DEFAULT 'same day'
        )
      `);
      console.log('🌱 Verified daily_chamber_temp_logs table is online.');
    } catch (chamberErr) {
      console.warn('⚠️ Table daily_chamber_temp_logs creation failed:', chamberErr.message);
    }

    // Auto migration: login lockout tracking (5 fails / 1h → 30 min lock)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS login_security (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(150) NOT NULL,
          role VARCHAR(50) DEFAULT NULL,
          failed_count INT NOT NULL DEFAULT 0,
          window_started_at DATETIME DEFAULT NULL,
          last_failed_at DATETIME DEFAULT NULL,
          locked_until DATETIME DEFAULT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          unique key uniq_login_security_email (email)
        )
      `);
      console.log('🌱 Verified login_security table is online.');
    } catch (loginSecErr) {
      console.warn('⚠️ Table login_security creation failed:', loginSecErr.message);
    }

    // Auto migration: Chambers and Client Assignments Daily Task Module
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chambers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('🌱 Verified chambers table is online.');
      // No default chamber seed — keep empty until Super Admin / DO adds real data
    } catch (chErr) {
      console.warn('⚠️ Table chambers creation failed:', chErr.message);
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chamber_client_assignments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          chamber_id INT NOT NULL,
          client_name VARCHAR(150) NOT NULL,
          warehouse_name VARCHAR(150) DEFAULT NULL,
          remark TEXT DEFAULT NULL,
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (chamber_id) REFERENCES chambers(id) ON DELETE CASCADE,
          UNIQUE KEY uq_chamber_client_wh (chamber_id, client_name, warehouse_name)
        )
      `);
      console.log('🌱 Verified chamber_client_assignments table is online.');

      // Check and add warehouse_name dynamically if table already exists
      const [columns] = await pool.query('SHOW COLUMNS FROM chamber_client_assignments');
      const colNames = columns.map(c => c.Field);
      
      if (!colNames.includes('warehouse_name')) {
        await pool.query('ALTER TABLE chamber_client_assignments ADD COLUMN warehouse_name VARCHAR(150) DEFAULT NULL');
        console.log('🌱 Added column warehouse_name to chamber_client_assignments.');
        
        // Also drop old unique key if it exists
        try {
          await pool.query('ALTER TABLE chamber_client_assignments DROP INDEX uq_chamber_client');
          console.log('🌱 Dropped deprecated unique index uq_chamber_client.');
        } catch (idxErr) {}
        
        // And add new unique constraint
        try {
          await pool.query('ALTER TABLE chamber_client_assignments ADD UNIQUE KEY uq_chamber_client_wh (chamber_id, client_name, warehouse_name)');
          console.log('🌱 Added unique index uq_chamber_client_wh.');
        } catch (idxErr) {}
      }

      if (!colNames.includes('remark')) {
        await pool.query('ALTER TABLE chamber_client_assignments ADD COLUMN remark TEXT DEFAULT NULL');
        console.log('🌱 Added column remark to chamber_client_assignments.');
      }

      if (!colNames.includes('status')) {
        await pool.query("ALTER TABLE chamber_client_assignments ADD COLUMN status VARCHAR(50) DEFAULT 'active'");
        console.log('🌱 Added column status to chamber_client_assignments.');
      }

      if (!colNames.includes('updated_at')) {
        await pool.query('ALTER TABLE chamber_client_assignments ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
        console.log('🌱 Added column updated_at to chamber_client_assignments.');
      }
      // No default Amul/HyFun/etc. assignment seed — keep empty for live data only
    } catch (assErr) {
      console.warn('⚠️ Table chamber_client_assignments creation failed:', assErr.message);
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS do_daily_inspections (
          id INT AUTO_INCREMENT PRIMARY KEY,
          operator_name VARCHAR(150) NOT NULL,
          chamber_id INT NOT NULL,
          client_name VARCHAR(150) NOT NULL,
          entry_date DATE NOT NULL,
          entry_time VARCHAR(50) NOT NULL,
          temperature DECIMAL(5,2) NOT NULL,
          photo_url VARCHAR(255) DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (chamber_id) REFERENCES chambers(id) ON DELETE CASCADE,
          UNIQUE KEY uq_date_chamber_client (entry_date, chamber_id, client_name)
        )
      `);
      console.log('🌱 Verified do_daily_inspections table is online.');
    } catch (inspErr) {
      console.warn('⚠️ Table do_daily_inspections creation failed:', inspErr.message);
    }


    // Auto migration: Add is_native to daily_chamber_temp_logs for native logs segregation
    try {
      await pool.query('ALTER TABLE daily_chamber_temp_logs ADD COLUMN is_native INT DEFAULT 0');
      console.log('🌱 Added is_native column to daily_chamber_temp_logs.');
    } catch (colErr) {
      // Ignored if column already exists
    }

    // Auto migration: Add box_count to daily_chamber_temp_logs
    try {
      await pool.query('ALTER TABLE daily_chamber_temp_logs ADD COLUMN box_count INT DEFAULT NULL');
      console.log('🌱 Added box_count column to daily_chamber_temp_logs.');
    } catch (colErr) {
      // Ignored if column already exists
    }

    // Auto migration: Add chamber_type to daily_chamber_temp_logs
    try {
      await pool.query("ALTER TABLE daily_chamber_temp_logs ADD COLUMN chamber_type VARCHAR(50) DEFAULT 'Frozen'");
      console.log('🌱 Added chamber_type column to daily_chamber_temp_logs.');
    } catch (colErr) {
      // Ignored if column already exists
    }

    // Auto migration: Add overdue_time to daily_chamber_temp_logs
    try {
      await pool.query("ALTER TABLE daily_chamber_temp_logs ADD COLUMN overdue_time VARCHAR(100) DEFAULT 'same day'");
      console.log('🌱 Added overdue_time column to daily_chamber_temp_logs.');
    } catch (colErr) {
      // Ignored if column already exists
    }

    // Auto migration: Add warehouse_name to daily_chamber_temp_logs
    try {
      await pool.query('ALTER TABLE daily_chamber_temp_logs ADD COLUMN warehouse_name VARCHAR(150) DEFAULT NULL');
      console.log('🌱 Added warehouse_name column to daily_chamber_temp_logs.');
    } catch (colErr) {
      // Ignored if column already exists
    }

    // Auto migration: Add shift to daily_chamber_temp_logs
    try {
      const [columns] = await pool.query("SHOW COLUMNS FROM daily_chamber_temp_logs LIKE 'shift'");
      if (columns.length === 0) {
        await pool.query("ALTER TABLE daily_chamber_temp_logs ADD COLUMN shift VARCHAR(50) DEFAULT 'Morning'");
        console.log('🌱 Added shift column to daily_chamber_temp_logs.');
      }
      // Backfill empty shift from slot time / created hour
      const [backfill] = await pool.query(`
        UPDATE daily_chamber_temp_logs
        SET shift = CASE
          WHEN inspection_time LIKE '10:00%' OR inspection_time IN ('10:00 AM', '10:00') THEN 'Morning'
          WHEN inspection_time LIKE '16:00%' OR inspection_time LIKE '18:00%'
            OR inspection_time IN ('16:00', '18:00', '04:00 PM', '06:00 PM') THEN 'Evening'
          WHEN HOUR(COALESCE(created_at, updated_at, NOW())) < 14 THEN 'Morning'
          ELSE 'Evening'
        END
        WHERE shift IS NULL OR TRIM(shift) = '' OR LOWER(TRIM(shift)) NOT IN ('morning', 'evening')
      `);
      if (backfill?.affectedRows > 0) {
        console.log(`🌱 Backfilled shift on ${backfill.affectedRows} chamber log(s).`);
      }
    } catch (colErr) {
      console.warn('⚠️ Failed to migrate shift column:', colErr.message);
    }

    // Auto migration: Add remarks to daily_chamber_temp_logs
    try {
      const [columns] = await pool.query("SHOW COLUMNS FROM daily_chamber_temp_logs LIKE 'remarks'");
      if (columns.length === 0) {
        await pool.query("ALTER TABLE daily_chamber_temp_logs ADD COLUMN remarks TEXT DEFAULT NULL");
        console.log('🌱 Added remarks column to daily_chamber_temp_logs.');
      }
    } catch (colErr) {
      console.warn('⚠️ Failed to migrate remarks column:', colErr.message);
    }

    // Auto migration: Rename chamber_temp to box_temp in daily_chamber_temp_logs
    try {
      const [columns] = await pool.query("SHOW COLUMNS FROM daily_chamber_temp_logs LIKE 'chamber_temp'");
      if (columns.length > 0) {
        await pool.query('ALTER TABLE daily_chamber_temp_logs CHANGE COLUMN chamber_temp box_temp DECIMAL(4,1) NOT NULL');
        console.log('🌱 Successfully renamed daily_chamber_temp_logs.chamber_temp to box_temp.');
      }
    } catch (colErr) {
      console.warn('⚠️ Failed to rename chamber_temp column:', colErr.message);
    }

    // Auto migration: Add chamber_id to daily_chamber_temp_logs
    try {
      const [columns] = await pool.query("SHOW COLUMNS FROM daily_chamber_temp_logs LIKE 'chamber_id'");
      if (columns.length === 0) {
        await pool.query('ALTER TABLE daily_chamber_temp_logs ADD COLUMN chamber_id INT DEFAULT NULL');
        console.log('🌱 Added chamber_id column to daily_chamber_temp_logs.');
      }
    } catch (colErr) {
      console.warn('⚠️ Failed to migrate chamber_id column:', colErr.message);
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
