-- Sub-Admins table (profile + DO-based access scope)
USE reeferon_crm_db;

CREATE TABLE IF NOT EXISTS sub_admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) DEFAULT NULL,
  phone_no VARCHAR(20) DEFAULT NULL,
  allowed_clients TEXT DEFAULT NULL COMMENT 'Comma-separated client names from DO monitors',
  allowed_warehouses TEXT DEFAULT NULL COMMENT 'Comma-separated warehouse names',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
