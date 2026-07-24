-- ReeferON CRM & DO Monitoring Database Schema
CREATE DATABASE IF NOT EXISTS reeferon_crm_db;
USE reeferon_crm_db;

-- 1. Daily Chamber Temperature Monitoring Table (With Temp Sensor Image & Time Comparison)
DROP TABLE IF EXISTS daily_chamber_temp_logs;

CREATE TABLE daily_chamber_temp_logs (
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
