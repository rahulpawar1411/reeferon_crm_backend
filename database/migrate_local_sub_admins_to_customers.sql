-- Run this on LOCALHOST MySQL (WAMP / phpMyAdmin), NOT FreeSQL.
-- Database: reeferon_crm_db (or your local CRM database)
--
-- What it does:
-- 1) Renames sub_admins → customers if customers does not exist
-- 2) If both exist: copies rows into customers, then drops sub_admins
-- 3) Updates login_security role sub_admin → customer

USE reeferon_crm_db;

-- Case A: only sub_admins exists → rename
-- (If this errors because customers already exists, ignore and use Case B below.)
RENAME TABLE sub_admins TO customers;

-- Case B: if rename failed because customers already exists, run these instead:
-- INSERT IGNORE INTO customers
--   (id, email, password, full_name, phone_no, allowed_clients, allowed_warehouses, created_at)
-- SELECT id, email, password, full_name, phone_no, allowed_clients, allowed_warehouses, created_at
-- FROM sub_admins;
-- DROP TABLE sub_admins;

-- Role backfill (safe even if 0 rows)
UPDATE login_security SET role = 'customer' WHERE role = 'sub_admin';

-- Verify:
SHOW TABLES LIKE 'customers';
SHOW TABLES LIKE 'sub_admins';
SELECT COUNT(*) AS customer_count FROM customers;
