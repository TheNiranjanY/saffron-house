# Demonstration runbook

A 10–12 minute live walkthrough of Saffron House: one operational order from a free table to a fully settled receipt, then the same facts viewed through TimescaleDB, SQL Lab and the benchmark panel.

## Before the demo

You need four processes reachable:

| Service | Address | Check |
| --- | --- | --- |
| MySQL 8.4 | `127.0.0.1:3307` | `docker compose ps` shows `saffron-mysql` healthy |
| TimescaleDB 2.31 | `127.0.0.1:5433` | `docker compose ps` shows `saffron-timescale` healthy |
| Flask API | `http://127.0.0.1:5001` | `curl http://127.0.0.1:5001/api/health` returns `"status": "ok"` |
| React SPA | `http://localhost:5173` | Dashboard loads with no degraded banner |

If the databases are not running:

```bash
docker compose up -d
```

If the application processes are not running, start them in two terminals:

```bash
# Terminal A
.venv/Scripts/python.exe backend/app.py

# Terminal B
cd frontend && npm run dev
```

### Optional clean slate (recommended before a graded demo)

The seed takes ~40 seconds and rebuilds 120 days of deterministic data. It requires both schemas to already exist.

```bash
.venv/Scripts/python.exe backend/scripts/seed.py
```

Expected finish: `29,831 orders · 100,180 items · 283,634 events`, outbox empty, 9 open orders on 9 occupied tables, 3 partial bills.

Open **http://localhost:5173** and leave the browser at a comfortable zoom (100%). The screenshots in this repository can be used as a fallback if a live step fails.

## The 10-minute script

### 0. Frame the architecture — 1 minute

1. On the **Dashboard**, point out the header chip **Dual store live** and the **Two stores, one truth** card: MySQL revenue equals TimescaleDB event revenue, difference ₹0.
2. Point to the left rail footer: **MySQL 8.4 / Operational**, **TimescaleDB / 18 chunks**, **Outbox drained**.
3. One sentence to set up the story: *"Every POS write commits business rows and outbox events together; a projector drains the outbox into TimescaleDB, and the charts read continuous aggregates."*

### 1. Open a floor table — 1 minute

1. Click **Table floor**.
2. Show 32 tables across Main Hall, Terrace, Garden and Private Dining; occupied tables are driven by open orders.
3. Pick a free table — for example **Table 1 · 2 seats**.
4. Click **New order** (or use the table's action if shown). The POS opens with that table preselected.

### 2. Build and send a ticket — 2 minutes

1. In **New order**, keep **Dine in**.
2. Choose **Table 1**, waiter **Aarav Nair**, and leave the guest as **Walk-in guest**. (Optional: press **+** beside Guest and create a guest inline.)
3. Under **Send to kitchen**, select chef **Sanjay Kapoor** (Tandoor).
4. Add **Butter Chicken** (₹480) and **Butter Naan** (₹70) from the menu. Show how price is snapshotted at order time.
5. Click **Send to kitchen**. The order detail opens with status **PLACED**.

**Talking point:** the ticket and its `ORDER_PLACED` + `ITEM_ADDED` events committed in one MySQL transaction, and the order timeline already shows them projected into the analytics hypertable. The toast also reports how many events were projected.

### 3. Move the kitchen — 1 minute

1. Click **Start prep** → toast *"Kitchen started"*, status **PREPARING**.
2. Click **Mark prepared** → status **PREPARED**.
3. Point at the **Order timeline**: placed → preparing → prepared, each with a restaurant-local time.

### 4. Generate the bill — 1 minute

1. Click **Generate bill**.
2. Keep **GST / tax rate** at **5%** and discount at **0%**.
3. Confirm. The bill becomes **#…**, status **BILLED**, grand total **₹577.50** (₹550 subtotal + ₹27.50 tax).
4. Explain the recognition rule on screen: **revenue is recognised when the bill is generated**; money collected is a separate event.

### 5. Split the payment — 2 minutes

1. Click **Settle bill** to open the payment counter.
2. In **Amount**, enter **300**. Choose **CASH**. Submit.
   - Bill status becomes **PARTIAL**.
   - The order stays **BILLED**; the table stays **OCCUPIED**.
   - A `PAYMENT_RECEIVED` event is written for ₹300.
3. Enter the balance **277.50**. Choose **UPI**. Submit.
   - Status flips to **PAID**.
   - The payment trigger closes the order (`ORDER_CLOSED`) and frees the table.
   - The toast confirms the table was released.
4. Open the printable receipt (**Print receipt** / **View receipt**) and point out **PAID IN FULL**, the two payment rows and the operational trail: prepared → bill generated → payment collected → table released.

**Talking point:** analytics is not a nightly batch. Every one of these commits enqueued an outbox row and the projector mirrored it immediately.

### 6. Show the same facts analytically — 2 minutes

Open **Analytics**:

1. **Revenue**: 30-day window, KPI cards, daily bars (MySQL ledger) against the line (TimescaleDB events), reconciliation footer **Sources agree · ₹0.00**, peak-hour heatmap.
   - This is `sales_hourly`, a continuous aggregate refreshed every 30 minutes. The projector also refreshes the current hour after each live write, so the reconciliation footer stays at **₹0.00** without waiting for the policy.
2. **Menu & flow**: top items with revenue share; explain there is no cross-database join because item/category names are snapshotted on each event.
3. **Kitchen**: prep-time percentiles, average vs p95 and the weekday heatmap.
4. **Payments**: stacked payment mix and collections versus revenue.
5. **Data platform**:
   - Hypertable footprint **~31 MB**, **18 chunks**.
   - **15 / 18 chunks compressed**, **12.9×** smaller, 92.3% saved.
   - Four continuous aggregates with 30-minute refresh and a 3-day lookback.
   - **Outbox health: Caught up**.

### 7. Prove the query layer — 1 minute

1. Click **SQL Lab**.
2. Run **Revenue · hourly gap-filled** — zero/revenue rows appear for quiet hours because of `time_bucket_gapfill`, not client-side filling.
3. Run **Kitchen prep time · percentiles** — p50/p95 are computed with `percentile_cont`.
4. Switch the database toggle to **MySQL**, run **Denormalization audit · bill_id** — billed lines missing or mismatching `bill_id` = 0. Explain this is the one deliberate denormalization inherited from DA2.
5. Attempt a write, e.g. `DELETE FROM payment;` → the server rejects it before execution (`Read-only` guard).

### 8. Close with the benchmark — 1 minute

1. On **Analytics → Data platform**, scroll to **MySQL vs TimescaleDB**.
2. Select **90d** and **5×**, click **Re-run**. This takes a few seconds.
3. Point out:
   - Same window, same dataset (212,484 events / 22,085 bills), **Exact match** reconciliation.
   - Daily revenue is much faster from the continuous aggregate; raw events are the fairer engine-to-engine comparison.
   - Top items is several times faster in the event store because it avoids multi-table joins.
4. Add the honest caveat: both stores are on one laptop, the data is 120 restaurant days, and absolute browser timings move with host load. The report's canonical figures come from the interleaved API benchmark (median of 30 samples per store).

## Optional proof commands (terminal, if asked)

```bash
# Health and live counts
curl -s http://127.0.0.1:5001/api/health

# Force a projector drain (normally done automatically after each write)
curl -s -X POST http://127.0.0.1:5001/api/system/sync

# Events for the order just demonstrated (replace <ORDER_ID>)
docker exec saffron-timescale psql -U restaurant -d restaurant_analytics \
  -c "SELECT event_type, count(*) FROM order_event WHERE order_id = <ORDER_ID> GROUP BY 1 ORDER BY 1;"

# MySQL-side lifecycle and payment state
docker exec saffron-mysql mysql -urestaurant -prestaurantpass restaurant \
  -e "SELECT order_id, status, table_id FROM orders WHERE order_id = <ORDER_ID>;
      SELECT bill_id, payment_status, grand_total FROM bill WHERE order_id = <ORDER_ID>;
      SELECT amount, payment_mode, payment_status FROM payment WHERE bill_id = <BILL_ID>;"

# Outbox health
docker exec saffron-mysql mysql -urestaurant -prestaurantpass restaurant \
  -e "SELECT COUNT(*) total, SUM(processed_at IS NULL) pending, SUM(attempts > 0 AND processed_at IS NULL) failed FROM analytics_outbox;"
```

## Screenshot cross-reference

| Step | Evidence |
| --- | --- |
| Dashboard and reconciliation | `screenshots/01-dashboard.png` |
| Floor plan | `screenshots/02-floor.png` |
| Orders list / menu manager | `screenshots/03-orders.png`, `screenshots/05-menu.png` |
| Billing ledger | `screenshots/04-billing.png` |
| Analytics tabs | `screenshots/06-analytics-revenue.png` … `09-analytics-payments.png` |
| Storage, CAGGs, outbox, benchmark | `screenshots/10-analytics-system.png`, `screenshots/16-benchmark.png` |
| SQL Lab | `screenshots/11-sql-lab.png` |
| Completed lifecycle and split receipt | `screenshots/12-order-closed.png`, `screenshots/13-receipt-paid.png` |
| Mobile responsive layout | `screenshots/14-mobile-dashboard.png`, `screenshots/15-mobile-pos.png` |

## Troubleshooting during the demo

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Header shows **Degraded** or **Analytics offline** | TimescaleDB not ready / down | `docker compose ps`; restart with `docker compose up -d`; refresh |
| POS menu fails, toast about the API | Flask not on 5001, or MySQL pool exhausted | Check Terminal A logs; confirm `curl /api/health`; restart Flask |
| Charts empty or stale | Seed not loaded, or CAGG not refreshed | Re-run the seed; wait for a live write; press **Sync analytics** |
| New events pending in outbox | Projector error | `POST /api/system/sync`; inspect `analytics_outbox.last_error`; check Timescale container |
| Port 5173/5001/3307/5433 already in use | Another service or old container | Stop the conflicting process, or change ports in `.env` (also update `frontend/vite.config.js` if Flask moves) |
| `mysql: command not found` on the host | MySQL runs in Docker, not on the host | Use `docker exec …` commands from this guide |
| PowerShell cannot use `<` redirection | PowerShell treats `<` differently | Use `Get-Content -Raw file.sql \| docker exec -i …` |
| Benchmark timings differ from the README | Browser-run timings include host load | Quote the canonical interleaved medians from `data/generated/benchmark-summary.json` |
| Data is in an unexpected state after testing | Automated/lifecycle tests created rows | Re-run the seed for a clean dataset |

## Teardown

```bash
# Stop app processes with Ctrl+C in their terminals, then:
docker compose stop       # keeps containers and data
# or
docker compose down       # removes containers, keeps named volumes
```

Do **not** use `docker compose down -v` unless you intend to delete both databases; the next start would then require loading the two schemas and re-seeding.
