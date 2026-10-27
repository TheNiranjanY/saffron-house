-- ============================================================
-- Saffron House — Time-series analytics database (TimescaleDB)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS timescaledb;

DROP MATERIALIZED VIEW IF EXISTS sales_hourly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS order_activity_hourly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS payments_hourly CASCADE;
DROP MATERIALIZED VIEW IF EXISTS kitchen_performance_hourly CASCADE;
DROP TABLE IF EXISTS order_event CASCADE;

-- ------------------------------------------------------------
-- One rich, denormalized event stream (analytics star table).
-- Dimension names are snapshotted at write time so the analytics
-- store never needs a cross-database join back into MySQL.
-- ------------------------------------------------------------
CREATE TABLE order_event (
    event_id         BIGSERIAL,
    event_time       TIMESTAMPTZ NOT NULL,
    event_type       TEXT NOT NULL,
    order_id         BIGINT NOT NULL,
    order_type       TEXT,
    table_id         INTEGER,
    customer_id      INTEGER,
    waiter_id        INTEGER,
    waiter_name      TEXT,
    chef_id          INTEGER,
    chef_name        TEXT,
    item_id          INTEGER,
    item_name        TEXT,
    category_name    TEXT,
    quantity         INTEGER,
    amount           NUMERIC(12, 2),
    payment_mode     TEXT,
    bill_id          BIGINT,
    payment_id       BIGINT,
    prep_seconds     INTEGER,
    source_outbox_id BIGINT,
    PRIMARY KEY (event_id, event_time),
    UNIQUE (source_outbox_id, event_time),
    CONSTRAINT chk_event_type CHECK (event_type IN (
        'ORDER_PLACED', 'ITEM_ADDED', 'ORDER_PREPARING', 'ORDER_PREPARED',
        'BILL_GENERATED', 'PAYMENT_RECEIVED', 'ORDER_CLOSED', 'ORDER_CANCELLED'
    ))
);

SELECT create_hypertable(
    'order_event',
    'event_time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX idx_event_type_time ON order_event (event_type, event_time DESC);
CREATE INDEX idx_event_order ON order_event (order_id, event_time DESC);
CREATE INDEX idx_event_item ON order_event (item_id, event_time DESC);
CREATE INDEX idx_event_chef ON order_event (chef_id, event_time DESC);
CREATE INDEX idx_event_waiter ON order_event (waiter_id, event_time DESC);
CREATE INDEX idx_event_bill ON order_event (bill_id, event_time DESC);

-- ------------------------------------------------------------
-- Continuous aggregates: incrementally maintained rollups.
-- Buckets are aligned to restaurant-local time (Asia/Kolkata).
-- Recent data remains queryable in real time (materialized_only=false).
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW sales_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', event_time, 'Asia/Kolkata') AS bucket,
       COUNT(*)        AS bills,
       SUM(amount)     AS revenue,
       AVG(amount)     AS avg_bill,
       SUM(quantity)   AS items_billed
  FROM order_event
 WHERE event_type = 'BILL_GENERATED'
 GROUP BY bucket
WITH NO DATA;

CREATE MATERIALIZED VIEW order_activity_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', event_time, 'Asia/Kolkata') AS bucket,
       COUNT(*)     AS orders_placed,
       SUM(quantity) AS guests
  FROM order_event
 WHERE event_type = 'ORDER_PLACED'
 GROUP BY bucket
WITH NO DATA;

CREATE MATERIALIZED VIEW payments_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', event_time, 'Asia/Kolkata') AS bucket,
       COUNT(*)    AS payment_count,
       SUM(amount) AS collected
  FROM order_event
 WHERE event_type = 'PAYMENT_RECEIVED'
 GROUP BY bucket
WITH NO DATA;

CREATE MATERIALIZED VIEW kitchen_performance_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', event_time, 'Asia/Kolkata') AS bucket,
       COUNT(*)          AS orders_prepared,
       AVG(prep_seconds) AS avg_prep_seconds,
       MAX(prep_seconds) AS max_prep_seconds
  FROM order_event
 WHERE event_type = 'ORDER_PREPARED'
 GROUP BY bucket
WITH NO DATA;

-- Serve the most recent (not yet materialized) hour from raw events so live
-- orders appear immediately instead of waiting for the next refresh.
ALTER MATERIALIZED VIEW sales_hourly SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW order_activity_hourly SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW payments_hourly SET (timescaledb.materialized_only = false);
ALTER MATERIALIZED VIEW kitchen_performance_hourly SET (timescaledb.materialized_only = false);

-- Keep aggregates fresh as new events stream in.
SELECT add_continuous_aggregate_policy('sales_hourly',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes');
SELECT add_continuous_aggregate_policy('order_activity_hourly',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes');
SELECT add_continuous_aggregate_policy('payments_hourly',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes');
SELECT add_continuous_aggregate_policy('kitchen_performance_hourly',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes');

-- ------------------------------------------------------------
-- Lifecycle management: compression + retention
-- ------------------------------------------------------------
ALTER TABLE order_event SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'event_type',
    timescaledb.compress_orderby = 'event_time DESC'
);

SELECT add_compression_policy('order_event', INTERVAL '14 days');
SELECT add_retention_policy('order_event', INTERVAL '730 days');
