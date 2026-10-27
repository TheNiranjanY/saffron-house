-- ============================================================
-- Saffron House — Operational database (MySQL 8.4)
-- Logical design carried forward from DA2 (Oracle SQL / PL-SQL)
-- ============================================================
SET NAMES utf8mb4;
SET time_zone = '+05:30';

SET FOREIGN_KEY_CHECKS = 0;
DROP TRIGGER IF EXISTS trg_orders_ai_status;
DROP TRIGGER IF EXISTS trg_orders_au_status;
DROP TRIGGER IF EXISTS trg_payment_ai_bill;
DROP PROCEDURE IF EXISTS add_order_item;
DROP PROCEDURE IF EXISTS generate_bill;
DROP FUNCTION IF EXISTS calc_grand_total;
DROP VIEW IF EXISTS DailySalesSummary;
DROP TABLE IF EXISTS analytics_outbox;
DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS order_item;
DROP TABLE IF EXISTS bill;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS menu_item;
DROP TABLE IF EXISTS menu_category;
DROP TABLE IF EXISTS dining_table;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS cashier;
DROP TABLE IF EXISTS chef;
DROP TABLE IF EXISTS waiter;
DROP TABLE IF EXISTS staff;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------
-- EER specialization: Staff -> Waiter / Chef / Cashier
-- ---------------------------------------------------------
CREATE TABLE staff (
    staff_id    INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    contact     VARCHAR(20)  NOT NULL,
    role        ENUM('WAITER', 'CHEF', 'CASHIER') NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_staff_contact CHECK (CHAR_LENGTH(contact) >= 10)
) ENGINE = InnoDB;

CREATE TABLE waiter (
    staff_id       INT PRIMARY KEY,
    table_section  VARCHAR(50) NOT NULL,
    CONSTRAINT fk_waiter_staff FOREIGN KEY (staff_id)
        REFERENCES staff (staff_id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE chef (
    staff_id     INT PRIMARY KEY,
    cuisine_type VARCHAR(50) NOT NULL,
    CONSTRAINT fk_chef_staff FOREIGN KEY (staff_id)
        REFERENCES staff (staff_id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE cashier (
    staff_id   INT PRIMARY KEY,
    counter_no INT NOT NULL,
    CONSTRAINT uq_cashier_counter UNIQUE (counter_no),
    CONSTRAINT fk_cashier_staff FOREIGN KEY (staff_id)
        REFERENCES staff (staff_id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- ---------------------------------------------------------
-- Dimensions
-- ---------------------------------------------------------
CREATE TABLE customer (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) NULL,
    phone       VARCHAR(20)  NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_customer_email UNIQUE (email)
) ENGINE = InnoDB;

CREATE TABLE dining_table (
    table_id INT PRIMARY KEY,
    capacity INT NOT NULL,
    status   ENUM('FREE', 'OCCUPIED') NOT NULL DEFAULT 'FREE',
    CONSTRAINT chk_table_capacity CHECK (capacity BETWEEN 1 AND 20)
) ENGINE = InnoDB;

CREATE TABLE menu_category (
    category_id   INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(80) NOT NULL,
    CONSTRAINT uq_category_name UNIQUE (category_name)
) ENGINE = InnoDB;

CREATE TABLE menu_item (
    item_id      INT AUTO_INCREMENT PRIMARY KEY,
    category_id  INT NOT NULL,
    name         VARCHAR(100) NOT NULL,
    description  VARCHAR(255) NULL,
    price        DECIMAL(10, 2) NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_veg       BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_menu_price CHECK (price >= 0),
    CONSTRAINT fk_menu_category FOREIGN KEY (category_id)
        REFERENCES menu_category (category_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------
-- Order lifecycle
-- ---------------------------------------------------------
CREATE TABLE orders (
    order_id   INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NULL,
    table_id    INT NULL,
    waiter_id   INT NOT NULL,
    cashier_id  INT NULL,
    order_type  ENUM('DINE_IN', 'TAKEAWAY', 'DELIVERY') NOT NULL DEFAULT 'DINE_IN',
    status      ENUM('PLACED', 'PREPARING', 'PREPARED', 'BILLED', 'CLOSED', 'CANCELLED')
                NOT NULL DEFAULT 'PLACED',
    placed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    prepared_at DATETIME NULL,
    closed_at   DATETIME NULL,
    notes       VARCHAR(255) NULL,
    CONSTRAINT chk_dine_in_table CHECK (order_type <> 'DINE_IN' OR table_id IS NOT NULL),
    CONSTRAINT fk_order_customer FOREIGN KEY (customer_id)
        REFERENCES customer (customer_id) ON DELETE SET NULL,
    CONSTRAINT fk_order_table FOREIGN KEY (table_id)
        REFERENCES dining_table (table_id),
    CONSTRAINT fk_order_waiter FOREIGN KEY (waiter_id)
        REFERENCES waiter (staff_id),
    CONSTRAINT fk_order_cashier FOREIGN KEY (cashier_id)
        REFERENCES cashier (staff_id),
    INDEX idx_orders_status_time (status, placed_at),
    INDEX idx_orders_table (table_id),
    INDEX idx_orders_placed_at (placed_at)
) ENGINE = InnoDB;

CREATE TABLE bill (
    bill_id         INT AUTO_INCREMENT PRIMARY KEY,
    order_id        INT NOT NULL,
    subtotal        DECIMAL(12, 2) NOT NULL,
    tax             DECIMAL(12, 2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    grand_total     DECIMAL(12, 2) NOT NULL,
    payment_status  ENUM('UNPAID', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'UNPAID',
    generated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_bill_order UNIQUE (order_id),
    CONSTRAINT fk_bill_order FOREIGN KEY (order_id)
        REFERENCES orders (order_id),
    CONSTRAINT chk_bill_total CHECK (grand_total >= 0),
    INDEX idx_bill_generated_at (generated_at)
) ENGINE = InnoDB;

CREATE TABLE order_item (
    order_id      INT NOT NULL,
    line_no       INT NOT NULL,
    item_id       INT NOT NULL,
    chef_id       INT NOT NULL,
    quantity      INT NOT NULL,
    price_at_order DECIMAL(10, 2) NOT NULL,
    bill_id       INT NULL,           -- intentional denormalization carried from DA2
    PRIMARY KEY (order_id, line_no),
    CONSTRAINT chk_order_item_qty CHECK (quantity > 0),
    CONSTRAINT fk_oi_order FOREIGN KEY (order_id)
        REFERENCES orders (order_id) ON DELETE CASCADE,
    CONSTRAINT fk_oi_item FOREIGN KEY (item_id)
        REFERENCES menu_item (item_id),
    CONSTRAINT fk_oi_chef FOREIGN KEY (chef_id)
        REFERENCES chef (staff_id),
    CONSTRAINT fk_oi_bill FOREIGN KEY (bill_id)
        REFERENCES bill (bill_id) ON DELETE SET NULL,
    INDEX idx_oi_bill (bill_id),
    INDEX idx_oi_item (item_id)
) ENGINE = InnoDB;

CREATE TABLE payment (
    payment_id     INT AUTO_INCREMENT PRIMARY KEY,
    bill_id        INT NOT NULL,
    amount         DECIMAL(12, 2) NOT NULL,
    payment_mode   ENUM('CASH', 'CARD', 'UPI', 'ONLINE') NOT NULL,
    payment_date   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payment_status ENUM('SUCCESS', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'SUCCESS',
    CONSTRAINT chk_payment_amount CHECK (amount > 0),
    CONSTRAINT fk_payment_bill FOREIGN KEY (bill_id)
        REFERENCES bill (bill_id),
    INDEX idx_payment_bill (bill_id, payment_date),
    INDEX idx_payment_date (payment_date)
) ENGINE = InnoDB;

-- ---------------------------------------------------------
-- Transactional outbox: MySQL state changes -> TimescaleDB
-- ---------------------------------------------------------
CREATE TABLE analytics_outbox (
    outbox_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_time  DATETIME(6) NOT NULL,
    event_type  VARCHAR(40) NOT NULL,
    payload     JSON NOT NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    processed_at DATETIME(6) NULL,
    attempts    INT NOT NULL DEFAULT 0,
    last_error  VARCHAR(500) NULL,
    INDEX idx_outbox_pending (processed_at, outbox_id),
    INDEX idx_outbox_created (created_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------
-- Automation: table occupancy and bill settlement
-- ---------------------------------------------------------
DELIMITER $$

CREATE TRIGGER trg_orders_ai_status
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
    IF NEW.table_id IS NOT NULL
       AND NEW.status IN ('PLACED', 'PREPARING', 'PREPARED', 'BILLED') THEN
        UPDATE dining_table
           SET status = 'OCCUPIED'
         WHERE table_id = NEW.table_id;
    END IF;
END$$

CREATE TRIGGER trg_orders_au_status
AFTER UPDATE ON orders
FOR EACH ROW
BEGIN
    IF NEW.table_id IS NOT NULL THEN
        IF NEW.status IN ('CLOSED', 'CANCELLED') THEN
            UPDATE dining_table
               SET status = 'FREE'
             WHERE table_id = NEW.table_id;
        ELSE
            UPDATE dining_table
               SET status = 'OCCUPIED'
             WHERE table_id = NEW.table_id;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_payment_ai_bill
AFTER INSERT ON payment
FOR EACH ROW
BEGIN
    DECLARE v_paid  DECIMAL(12, 2) DEFAULT 0;
    DECLARE v_total DECIMAL(12, 2) DEFAULT 0;
    DECLARE v_order_id INT;

    IF NEW.payment_status = 'SUCCESS' THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_paid
          FROM payment
         WHERE bill_id = NEW.bill_id
           AND payment_status = 'SUCCESS';

        SELECT grand_total, order_id INTO v_total, v_order_id
          FROM bill
         WHERE bill_id = NEW.bill_id;

        UPDATE bill
           SET payment_status = CASE
                   WHEN v_paid >= v_total THEN 'PAID'
                   WHEN v_paid > 0 THEN 'PARTIAL'
                   ELSE 'UNPAID'
               END
         WHERE bill_id = NEW.bill_id;

        IF v_paid >= v_total THEN
            UPDATE orders
               SET status = 'CLOSED',
                   closed_at = COALESCE(closed_at, NEW.payment_date)
             WHERE order_id = v_order_id
               AND status <> 'CLOSED';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------
-- Stored routines (MySQL equivalents of the DA2 PL/SQL layer)
-- ---------------------------------------------------------
CREATE PROCEDURE add_order_item(
    IN  p_order_id INT,
    IN  p_item_id  INT,
    IN  p_chef_id  INT,
    IN  p_qty      INT,
    OUT p_line_no  INT
)
BEGIN
    DECLARE v_status       VARCHAR(20);
    DECLARE v_is_available BOOLEAN;
    DECLARE v_price        DECIMAL(10, 2);
    DECLARE v_count        INT DEFAULT 0;

    SELECT COUNT(*) INTO v_count FROM orders WHERE order_id = p_order_id;
    IF v_count = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Order does not exist';
    END IF;

    SELECT COUNT(*) INTO v_count FROM bill WHERE order_id = p_order_id;
    IF v_count > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot add items to a billed order';
    END IF;

    SELECT status INTO v_status FROM orders WHERE order_id = p_order_id;
    IF v_status NOT IN ('PLACED', 'PREPARING') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Order is not open for new items';
    END IF;

    IF p_qty <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quantity must be positive';
    END IF;

    SELECT COUNT(*) INTO v_count FROM chef WHERE staff_id = p_chef_id;
    IF v_count = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chef does not exist';
    END IF;

    SELECT COUNT(*) INTO v_count FROM menu_item WHERE item_id = p_item_id;
    IF v_count = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Menu item does not exist';
    END IF;

    SELECT is_available, price INTO v_is_available, v_price
      FROM menu_item
     WHERE item_id = p_item_id;

    IF v_is_available = FALSE THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Menu item is currently unavailable';
    END IF;

    SELECT COALESCE(MAX(line_no), 0) + 1 INTO p_line_no
      FROM order_item
     WHERE order_id = p_order_id;

    INSERT INTO order_item (order_id, line_no, item_id, chef_id, quantity, price_at_order)
    VALUES (p_order_id, p_line_no, p_item_id, p_chef_id, p_qty, v_price);
END$$

CREATE PROCEDURE generate_bill(
    IN  p_order_id     INT,
    IN  p_discount_pct DECIMAL(5, 2),
    IN  p_tax_rate     DECIMAL(5, 4),
    OUT p_bill_id      INT
)
BEGIN
    DECLARE v_subtotal DECIMAL(12, 2) DEFAULT 0;
    DECLARE v_tax      DECIMAL(12, 2) DEFAULT 0;
    DECLARE v_discount DECIMAL(12, 2) DEFAULT 0;
    DECLARE v_grand    DECIMAL(12, 2) DEFAULT 0;
    DECLARE v_status   VARCHAR(20);
    DECLARE v_count    INT DEFAULT 0;

    IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Discount percent must be between 0 and 100';
    END IF;

    IF p_tax_rate < 0 OR p_tax_rate > 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tax rate must be between 0 and 1';
    END IF;

    SELECT COUNT(*) INTO v_count FROM orders WHERE order_id = p_order_id;
    IF v_count = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Order does not exist';
    END IF;

    SELECT COUNT(*) INTO v_count FROM bill WHERE order_id = p_order_id;
    IF v_count > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A bill already exists for this order';
    END IF;

    SELECT status INTO v_status FROM orders WHERE order_id = p_order_id;
    IF v_status IN ('CANCELLED', 'CLOSED') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot bill a closed or cancelled order';
    END IF;

    SELECT COALESCE(SUM(quantity * price_at_order), 0) INTO v_subtotal
      FROM order_item
     WHERE order_id = p_order_id;

    IF v_subtotal <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot bill an order without items';
    END IF;

    SET v_tax = ROUND(v_subtotal * p_tax_rate, 2);
    SET v_discount = ROUND(v_subtotal * p_discount_pct / 100, 2);
    SET v_grand = v_subtotal + v_tax - v_discount;

    INSERT INTO bill (order_id, subtotal, tax, discount_amount, grand_total, generated_at)
    VALUES (p_order_id, v_subtotal, v_tax, v_discount, v_grand, NOW());

    SET p_bill_id = LAST_INSERT_ID();

    UPDATE order_item
       SET bill_id = p_bill_id
     WHERE order_id = p_order_id;

    UPDATE orders
       SET status = 'BILLED'
     WHERE order_id = p_order_id
       AND status NOT IN ('CLOSED', 'CANCELLED');
END$$

CREATE FUNCTION calc_grand_total(p_bill_id INT)
RETURNS DECIMAL(12, 2)
DETERMINISTIC
READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(12, 2) DEFAULT 0;

    SELECT subtotal + tax - discount_amount INTO v_total
      FROM bill
     WHERE bill_id = p_bill_id;

    RETURN COALESCE(v_total, 0);
END$$

DELIMITER ;

CREATE OR REPLACE VIEW DailySalesSummary AS
SELECT DATE(generated_at) AS sale_date,
       COUNT(bill_id)     AS total_bills,
       SUM(grand_total)   AS total_revenue
  FROM bill
 GROUP BY DATE(generated_at);
