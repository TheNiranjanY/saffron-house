"""Curated, read-only queries that demonstrate the analytics model."""

CATALOG = [
    {
        "id": "ts-revenue-gapfill",
        "db": "timescale",
        "title": "Revenue · hourly gap-filled",
        "concept": "time_bucket_gapfill + FILTER",
        "description": (
            "Fills quiet hours with zero instead of dropping them, so chart axes stay honest. "
            "Only billing events contribute to revenue."
        ),
        "tags": ["time_bucket_gapfill", "time-series", "hourly"],
        "sql": """
SELECT
    time_bucket_gapfill('1 hour', event_time, 'Asia/Kolkata') AS bucket,
    COALESCE(SUM(amount) FILTER (WHERE event_type = 'BILL_GENERATED'), 0) AS revenue,
    COUNT(*) FILTER (WHERE event_type = 'BILL_GENERATED') AS bills
FROM order_event
WHERE event_time >= now() - INTERVAL '48 hours'
  AND event_time < now()
GROUP BY bucket
ORDER BY bucket
""".strip(),
    },
    {
        "id": "ts-revenue-rolling",
        "db": "timescale",
        "title": "Daily revenue · 7-day rolling average",
        "concept": "Window functions over time buckets",
        "description": (
            "Builds a smoothed trend line from daily revenue inside the database, "
            "avoiding a round trip of 120 rows to the application."
        ),
        "tags": ["window", "rolling-average", "trend"],
        "sql": """
WITH daily AS (
    SELECT time_bucket('1 day', event_time, 'Asia/Kolkata') AS day,
           SUM(amount) AS revenue,
           COUNT(*)   AS bills
      FROM order_event
     WHERE event_type = 'BILL_GENERATED'
       AND event_time >= now() - INTERVAL '120 days'
     GROUP BY day
)
SELECT day::date AS day,
       bills,
       revenue,
       ROUND(AVG(revenue) OVER (
           ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
       ), 2) AS rolling_7d_avg
  FROM daily
 ORDER BY day DESC
""".strip(),
    },
    {
        "id": "ts-peak-hours",
        "db": "timescale",
        "title": "Peak hours · weekday × hour heatmap",
        "concept": "Local-time alignment with time_bucket",
        "description": (
            "Buckets are aligned to Asia/Kolkata inside the continuous aggregate, "
            "then reshaped into a 7×24 matrix for staffing decisions."
        ),
        "tags": ["heatmap", "staffing", "continuous aggregate"],
        "sql": """
SELECT
    TO_CHAR(bucket AT TIME ZONE 'Asia/Kolkata', 'Dy')              AS day_name,
    EXTRACT(ISODOW FROM bucket AT TIME ZONE 'Asia/Kolkata')::int  AS dow,
    EXTRACT(HOUR   FROM bucket AT TIME ZONE 'Asia/Kolkata')::int  AS hour,
    SUM(bills)::int                                                AS bills,
    SUM(revenue)                                                   AS revenue
FROM sales_hourly
WHERE bucket >= now() - INTERVAL '30 days'
GROUP BY 1, 2, 3
ORDER BY 2, 3
""".strip(),
    },
    {
        "id": "ts-top-items",
        "db": "timescale",
        "title": "Top 10 menu items · revenue share",
        "concept": "Denormalized dimension snapshots",
        "description": (
            "Item and category names are snapshotted onto each event, so this query "
            "never joins back to the operational MySQL database."
        ),
        "tags": ["menu", "window", "denormalized"],
        "sql": """
WITH item_sales AS (
    SELECT item_name,
           category_name,
           SUM(quantity)::int AS qty,
           SUM(amount)        AS revenue
      FROM order_event
     WHERE event_type = 'ITEM_ADDED'
       AND event_time >= now() - INTERVAL '30 days'
     GROUP BY item_name, category_name
)
SELECT item_name,
       category_name,
       qty,
       revenue,
       ROUND(100 * revenue / SUM(revenue) OVER (), 2) AS revenue_share_pct
  FROM item_sales
 ORDER BY revenue DESC
 LIMIT 10
""".strip(),
    },
    {
        "id": "ts-kitchen-percentiles",
        "db": "timescale",
        "title": "Kitchen prep time · percentiles",
        "concept": "percentile_cont on event stream",
        "description": (
            "Median and p95 preparation time per day. Percentiles are far more useful "
            "than an average when a few slow tickets skew the service."
        ),
        "tags": ["percentile", "kitchen", "sla"],
        "sql": """
SELECT time_bucket('1 day', event_time, 'Asia/Kolkata')::date AS day,
       COUNT(*)::int AS orders_prepared,
       ROUND(AVG(prep_seconds))::int                                    AS avg_seconds,
       ROUND(percentile_cont(0.5)  WITHIN GROUP (ORDER BY prep_seconds)::numeric)::int AS median_seconds,
       ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY prep_seconds)::numeric)::int AS p95_seconds
  FROM order_event
 WHERE event_type = 'ORDER_PREPARED'
   AND prep_seconds IS NOT NULL
   AND event_time >= now() - INTERVAL '14 days'
 GROUP BY day
 ORDER BY day
""".strip(),
    },
    {
        "id": "ts-payment-pivot",
        "db": "timescale",
        "title": "Payment mix · daily pivot",
        "concept": "Aggregate FILTER pivoting",
        "description": (
            "Turns a long payment event stream into one row per day with columns per mode, "
            "ready for a stacked bar chart without client-side transformation."
        ),
        "tags": ["payments", "pivot", "filter"],
        "sql": """
SELECT time_bucket('1 day', event_time, 'Asia/Kolkata')::date AS day,
       SUM(amount) FILTER (WHERE payment_mode = 'CASH')   AS cash,
       SUM(amount) FILTER (WHERE payment_mode = 'CARD')   AS card,
       SUM(amount) FILTER (WHERE payment_mode = 'UPI')    AS upi,
       SUM(amount) FILTER (WHERE payment_mode = 'ONLINE') AS online,
       SUM(amount)                                        AS total
  FROM order_event
 WHERE event_type = 'PAYMENT_RECEIVED'
   AND event_time >= now() - INTERVAL '14 days'
 GROUP BY day
 ORDER BY day
""".strip(),
    },
    {
        "id": "ts-order-funnel",
        "db": "timescale",
        "title": "Order funnel · last 30 days",
        "concept": "COUNT(DISTINCT) FILTER",
        "description": (
            "Measures how placed orders progress to prepared, billed and closed. "
            "Cancellations are reported separately instead of being hidden."
        ),
        "tags": ["funnel", "conversion", "events"],
        "sql": """
SELECT
    COUNT(DISTINCT order_id) FILTER (WHERE event_type = 'ORDER_PLACED')::int    AS placed,
    COUNT(DISTINCT order_id) FILTER (WHERE event_type = 'ORDER_PREPARED')::int  AS prepared,
    COUNT(DISTINCT order_id) FILTER (WHERE event_type = 'BILL_GENERATED')::int  AS billed,
    COUNT(DISTINCT order_id) FILTER (WHERE event_type = 'ORDER_CLOSED')::int    AS closed,
    COUNT(DISTINCT order_id) FILTER (WHERE event_type = 'ORDER_CANCELLED')::int AS cancelled,
    ROUND(
        100.0 * COUNT(DISTINCT order_id) FILTER (WHERE event_type = 'ORDER_CLOSED')
              / NULLIF(COUNT(DISTINCT order_id) FILTER (WHERE event_type = 'ORDER_PLACED'), 0),
        1
    ) AS closure_rate_pct
FROM order_event
WHERE event_time >= now() - INTERVAL '30 days'
""".strip(),
    },
    {
        "id": "ts-waiter-leaderboard",
        "db": "timescale",
        "title": "Waiter leaderboard · revenue share",
        "concept": "Snapshot dimensions + window share",
        "description": (
            "Waiter names are captured on each bill event. A staff rename in MySQL "
            "will not rewrite history, which is the correct behaviour for an audit trail."
        ),
        "tags": ["staff", "revenue", "snapshot"],
        "sql": """
SELECT waiter_name,
       COUNT(*)::int AS bills,
       SUM(amount)   AS revenue,
       ROUND(AVG(amount), 2) AS avg_bill,
       ROUND(100 * SUM(amount) / SUM(SUM(amount)) OVER (), 2) AS revenue_share_pct
  FROM order_event
 WHERE event_type = 'BILL_GENERATED'
   AND event_time >= now() - INTERVAL '30 days'
 GROUP BY waiter_name
 ORDER BY revenue DESC
""".strip(),
    },
    {
        "id": "ts-compression-audit",
        "db": "timescale",
        "title": "Compression audit · per chunk",
        "concept": "Native columnar compression",
        "description": (
            "Shows the before/after size of every weekly chunk. Chunks older than 14 days "
            "are compressed automatically; recent chunks stay uncompressed for fast ingest."
        ),
        "tags": ["compression", "storage", "chunks"],
        "sql": """
SELECT s.chunk_name,
       s.compression_status,
       c.range_start::date AS chunk_start,
       pg_size_pretty(s.before_compression_total_bytes) AS uncompressed,
       pg_size_pretty(s.after_compression_total_bytes)  AS compressed,
       ROUND(100.0 * s.after_compression_total_bytes
             / NULLIF(s.before_compression_total_bytes, 0), 1) AS pct_of_original
  FROM chunk_compression_stats('order_event') s
  LEFT JOIN timescaledb_information.chunks c
         ON c.chunk_name = s.chunk_name
        AND c.hypertable_name = 'order_event'
 ORDER BY c.range_start DESC
""".strip(),
    },
    {
        "id": "ts-caggs",
        "db": "timescale",
        "title": "Continuous aggregates · inventory",
        "concept": "Incrementally maintained rollups",
        "description": (
            "Lists the four continuous aggregates, their materialization hypertables and sizes. "
            "The application reads these instead of scanning raw events."
        ),
        "tags": ["continuous aggregate", "catalog"],
        "sql": """
SELECT view_name,
       materialized_only,
       materialization_hypertable_name,
       pg_size_pretty(
           pg_total_relation_size(
               format('%I.%I', materialization_hypertable_schema,
                      materialization_hypertable_name)::regclass
           )
       ) AS materialized_size
  FROM timescaledb_information.continuous_aggregates
 ORDER BY view_name
""".strip(),
    },
    {
        "id": "my-daily-sales",
        "db": "mysql",
        "title": "DailySalesSummary · operational view",
        "concept": "Relational view baseline",
        "description": (
            "The DA2-style view over the normalized bill table. This is the baseline the "
            "time-series store is compared against."
        ),
        "tags": ["view", "baseline", "mysql"],
        "sql": """
SELECT sale_date, total_bills, total_revenue
  FROM DailySalesSummary
 ORDER BY sale_date DESC
 LIMIT 14
""".strip(),
    },
    {
        "id": "my-payment-mix",
        "db": "mysql",
        "title": "Payment mode mix · 30 days",
        "concept": "Operational payment ledger",
        "description": "Settlement totals from the normalized payment table.",
        "tags": ["payments", "mysql"],
        "sql": """
SELECT payment_mode,
       COUNT(*)       AS payments,
       SUM(amount)     AS collected,
       ROUND(AVG(amount), 2) AS avg_payment
  FROM payment
 WHERE payment_status = 'SUCCESS'
   AND payment_date >= NOW() - INTERVAL 30 DAY
 GROUP BY payment_mode
 ORDER BY collected DESC
""".strip(),
    },
    {
        "id": "my-waiter-leaderboard",
        "db": "mysql",
        "title": "Waiter performance · joins",
        "concept": "Normalized joins across five tables",
        "description": (
            "The same business question answered relationally. It needs waiter, staff, orders "
            "and bill joins; the time-series version reads one denormalized table."
        ),
        "tags": ["joins", "waiter", "mysql"],
        "sql": """
SELECT s.name                    AS waiter,
       COUNT(DISTINCT o.order_id) AS orders,
       SUM(b.grand_total)         AS revenue,
       ROUND(AVG(b.grand_total), 2) AS avg_bill
  FROM waiter w
  JOIN staff s ON s.staff_id = w.staff_id
  LEFT JOIN orders o ON o.waiter_id = w.staff_id
                    AND o.placed_at >= NOW() - INTERVAL 30 DAY
  LEFT JOIN bill b ON b.order_id = o.order_id
 GROUP BY w.staff_id, s.name
 ORDER BY revenue DESC
""".strip(),
    },
    {
        "id": "my-outbox",
        "db": "mysql",
        "title": "Outbox projector · health",
        "concept": "Transactional outbox",
        "description": (
            "The outbox is written in the same transaction as the POS change, then drained into "
            "TimescaleDB. Pending = 0 means analytics is caught up."
        ),
        "tags": ["outbox", "consistency", "mysql"],
        "sql": """
SELECT COUNT(*)                                                    AS total_events,
       SUM(processed_at IS NULL)                                   AS pending,
       SUM(processed_at IS NULL AND attempts > 0)                  AS failed,
       ROUND(AVG(TIMESTAMPDIFF(SECOND, created_at, processed_at)), 3) AS avg_projection_seconds,
       MAX(attempts)                                               AS max_attempts
  FROM analytics_outbox
""".strip(),
    },
    {
        "id": "my-billid-audit",
        "db": "mysql",
        "title": "Denormalization audit · bill_id",
        "concept": "Intentional denormalization",
        "description": (
            "OrderItem.bill_id is the one deliberate BCNF violation carried from DA2. "
            "This audit proves it never disagrees with the authoritative bill table."
        ),
        "tags": ["normalization", "audit", "mysql"],
        "sql": """
SELECT COUNT(*) AS billed_lines,
       SUM(oi.bill_id IS NULL)                          AS lines_missing_bill_id,
       SUM(oi.bill_id <> b.bill_id)                     AS mismatched_bill_ids
  FROM order_item oi
  JOIN orders o  ON o.order_id = oi.order_id
  JOIN bill   b  ON b.order_id = o.order_id
 WHERE o.status IN ('BILLED', 'CLOSED')
""".strip(),
    },
]


def find(query_id):
    return next((item for item in CATALOG if item["id"] == query_id), None)
