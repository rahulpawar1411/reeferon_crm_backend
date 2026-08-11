-- Super Admin ↔ Customer notes / chat updates
CREATE TABLE IF NOT EXISTS customer_admin_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT DEFAULT NULL,
  customer_email VARCHAR(150) NOT NULL,
  customer_name VARCHAR(150) DEFAULT NULL,
  author_role VARCHAR(50) NOT NULL,
  author_email VARCHAR(150) NOT NULL,
  author_name VARCHAR(150) DEFAULT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_can_email (customer_email),
  INDEX idx_can_customer_id (customer_id),
  INDEX idx_can_created (created_at)
);
