const db = require('../config/db');

async function run() {
  try {
    // 1. Create table if not exists with all required fields
    await db.query(`
      CREATE TABLE IF NOT EXISTS inward_temp_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entry_date DATE NOT NULL,
        vehicle_no VARCHAR(50) NOT NULL,
        seal_no VARCHAR(100) DEFAULT NULL,
        vehicle_temp DECIMAL(4,1) DEFAULT NULL,
        material_temp DECIMAL(4,1) DEFAULT NULL,
        transporter_name VARCHAR(150) DEFAULT NULL,
        driver_name VARCHAR(100) DEFAULT NULL,
        driver_no VARCHAR(50) DEFAULT NULL,
        client_name VARCHAR(150) NOT NULL,
        dock_no VARCHAR(50) DEFAULT NULL,
        vehicle_reporting_time VARCHAR(50) DEFAULT NULL,
        unloading_start_time VARCHAR(50) DEFAULT NULL,
        unloading_end_time VARCHAR(50) DEFAULT NULL,
        pallets_in_qty INT DEFAULT 0,
        invoice_qty INT DEFAULT 0,
        received_qty INT DEFAULT 0,
        received_boxes_qty INT DEFAULT 0,
        short_received_boxes_qty INT DEFAULT 0,
        excess_received_boxes_qty INT DEFAULT 0,
        damage_received_boxes_qty INT DEFAULT 0,
        material_type VARCHAR(100) DEFAULT NULL,
        unloading_supervisor_name VARCHAR(150) DEFAULT NULL,
        remarks TEXT DEFAULT NULL,
        invoice_photos TEXT DEFAULT NULL,
        pod_photo VARCHAR(255) DEFAULT NULL,
        vehicle_seal_photo VARCHAR(255) DEFAULT NULL,
        vehicle_temp_photo VARCHAR(255) DEFAULT NULL,
        material_temp_photo VARCHAR(255) DEFAULT NULL,
        vehicle_back_side_photo VARCHAR(255) DEFAULT NULL,
        damage_boxes_photo VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ inward_temp_logs table verified/created successfully.");

    // 2. Ensure vehicle_temp and material_temp columns exist if the table was previously created without them
    const [columns] = await db.query("SHOW COLUMNS FROM inward_temp_logs");
    const columnNames = columns.map(c => c.Field);
    
    if (!columnNames.includes('vehicle_temp')) {
      await db.query("ALTER TABLE inward_temp_logs ADD COLUMN vehicle_temp DECIMAL(4,1) DEFAULT NULL");
      console.log("➕ Added vehicle_temp column to inward_temp_logs.");
    } else {
      console.log("ℹ️ vehicle_temp column already exists.");
    }
    
    if (!columnNames.includes('material_temp')) {
      await db.query("ALTER TABLE inward_temp_logs ADD COLUMN material_temp DECIMAL(4,1) DEFAULT NULL");
      console.log("➕ Added material_temp column to inward_temp_logs.");
    } else {
      console.log("ℹ️ material_temp column already exists.");
    }
    
    console.log("🎉 Database schema verification completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error running database migration:", err);
    process.exit(1);
  }
}

run();
