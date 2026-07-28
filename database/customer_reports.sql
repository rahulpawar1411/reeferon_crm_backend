-- Dedicated table for customer (Sub Admin) issue reports
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
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_customer_reports_ref (reference_no),
  INDEX idx_customer_reports_email (customer_email),
  INDEX idx_customer_reports_status (status),
  INDEX idx_customer_reports_customer_id (customer_id)
);
