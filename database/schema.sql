-- ReeferON CRM & DO Monitoring Database Schema
CREATE DATABASE IF NOT EXISTS reeferon_crm_db;
USE reeferon_crm_db;

-- 1. Daily Chamber Temperature Monitoring Table (With Temp Sensor Image & Time Comparison)
DROP TABLE IF EXISTS daily_chamber_temp_logs;

CREATE TABLE daily_chamber_temp_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reference_no VARCHAR(50) DEFAULT NULL,
    entry_date DATE NOT NULL,
    client_name VARCHAR(150) NOT NULL,
    chamber_name VARCHAR(100) NOT NULL,
    inspection_time VARCHAR(50) NOT NULL,
    box_temp DECIMAL(4,1) NOT NULL,
    monitor_supervisor_name VARCHAR(150) NOT NULL,
    temp_sensor_image VARCHAR(255) DEFAULT NULL,
    photo_capture_time VARCHAR(50) DEFAULT NULL,
    time_variance_minutes INT DEFAULT 0,
    box_count INT DEFAULT NULL,
    chamber_type VARCHAR(50) DEFAULT 'Frozen',
    overdue_time VARCHAR(100) DEFAULT 'same day',
    warehouse_name VARCHAR(150) DEFAULT NULL,
    operator_email VARCHAR(150) DEFAULT NULL,
    is_native INT DEFAULT 0,
    update_details TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Inward & Outward Reefer Movement Logs Table
CREATE TABLE IF NOT EXISTS inward_outward_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entry_type ENUM('Inward', 'Outward') NOT NULL,
    container_number VARCHAR(50) NOT NULL,
    client_name VARCHAR(150) NOT NULL,
    location_dock VARCHAR(100) DEFAULT 'Bay 1',
    cargo_type VARCHAR(100) DEFAULT 'Cold Cargo',
    target_temp DECIMAL(4,1) NOT NULL,
    actual_temp DECIMAL(4,1) NOT NULL,
    temp_variance DECIMAL(4,1) DEFAULT 0.0,
    status ENUM('Normal', 'Warning', 'Critical') DEFAULT 'Normal',
    seal_number VARCHAR(100) DEFAULT NULL,
    genset_status VARCHAR(50) DEFAULT 'Running',
    driver_name VARCHAR(100) DEFAULT NULL,
    driver_phone VARCHAR(20) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Sales Leads Table
CREATE TABLE IF NOT EXISTS leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    client_name VARCHAR(150) NOT NULL,
    company VARCHAR(150) DEFAULT NULL,
    email VARCHAR(100) DEFAULT NULL,
    phone VARCHAR(20) NOT NULL,
    service_required VARCHAR(100) DEFAULT 'Cold Storage',
    status ENUM('New', 'Contacted', 'In-Progress', 'Won', 'Lost') DEFAULT 'New',
    value VARCHAR(50) DEFAULT '₹0',
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Inward Temperature Logs Table
CREATE TABLE IF NOT EXISTS inward_temp_logs (
    inward_id INT AUTO_INCREMENT PRIMARY KEY,
    inward_entry_date DATE NOT NULL,
    inward_vehicle_no VARCHAR(50) NOT NULL,
    inward_seal_no VARCHAR(100) DEFAULT NULL,
    inward_vehicle_temp DECIMAL(5,2) DEFAULT NULL,
    inward_material_temp DECIMAL(5,2) DEFAULT NULL,
    inward_transporter_name VARCHAR(150) DEFAULT NULL,
    inward_driver_name VARCHAR(150) DEFAULT NULL,
    inward_driver_no VARCHAR(50) DEFAULT NULL,
    inward_client_name VARCHAR(150) NOT NULL,
    inward_dock_no VARCHAR(50) DEFAULT NULL,
    inward_vehicle_reporting_time VARCHAR(50) DEFAULT NULL,
    inward_unloading_start_time VARCHAR(50) DEFAULT NULL,
    inward_unloading_duration_hours VARCHAR(50) DEFAULT NULL,
    inward_unloading_duration_mins VARCHAR(50) DEFAULT NULL,
    inward_unloading_end_time VARCHAR(50) DEFAULT NULL,
    inward_pallets_in_qty INT DEFAULT 0,
    inward_invoice_qty INT DEFAULT 0,
    inward_received_qty INT DEFAULT 0,
    inward_received_boxes_qty INT DEFAULT 0,
    inward_short_received_boxes_qty INT DEFAULT 0,
    inward_excess_received_boxes_qty INT DEFAULT 0,
    inward_damage_received_boxes_qty INT DEFAULT 0,
    inward_material_type VARCHAR(100) DEFAULT NULL,
    inward_unloading_supervisor_name VARCHAR(150) DEFAULT NULL,
    inward_remarks TEXT DEFAULT NULL,
    inward_invoice_photos VARCHAR(255) DEFAULT NULL,
    inward_pod_photo VARCHAR(255) DEFAULT NULL,
    inward_vehicle_seal_photo VARCHAR(255) DEFAULT NULL,
    inward_vehicle_temp_photo VARCHAR(255) DEFAULT NULL,
    inward_material_temp_photo VARCHAR(255) DEFAULT NULL,
    inward_vehicle_back_side_photo VARCHAR(255) DEFAULT NULL,
    inward_vehicle_back_side_photo_with_material VARCHAR(255) DEFAULT NULL,
    inward_count_sheet_photo VARCHAR(255) DEFAULT NULL,
    inward_damage_boxes_photo TEXT DEFAULT NULL,
    update_details TEXT DEFAULT NULL,
    inward_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    inward_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 5. Sub-Admins (restricted admin access by client / warehouse)
CREATE TABLE IF NOT EXISTS sub_admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) DEFAULT NULL,
    phone_no VARCHAR(20) DEFAULT NULL,
    allowed_clients TEXT DEFAULT NULL,
    allowed_warehouses TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
