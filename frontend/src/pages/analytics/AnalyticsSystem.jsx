import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Boxes,
  Database,
  Gauge,
  Layers3,
  Monitor,
  Play,
  RefreshCw,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, useFetch } from "../../lib/api";
import { CHART } from "../../lib/constants";
import { formatDate, fromNow, inr, num, pct } from "../../lib/format";
import { axisProps, ChartLegend, ChartTip, gridProps } from "../../components/Charts";
import { Badge, Button, Card, CardHeader, ErrorState, Loading, Segmented, StatCard } from "../../components/UI";
import { AnalyticsLoading, AnalyticsNote } from "./shared";

let cachedBenchmark = null;

const SHORT_SCENARIO = {
  daily_revenue: "Daily revenue",
  hourly_revenue: "Hourly revenue",
  top_items: "Top 10 items",
};

const PIPELINE = [
  { icon: Monitor, title: "POS & API", caption: "Orders, bills and payments commit." },
  { icon: Database, title: "MySQL + outbox", caption: "Business rows and outbox row share one transaction." },
  { icon: RefreshCw, title: "Projector", caption: "SKIP LOCKED batches drain the outbox." },
  { icon: Boxes, title: "order_event", caption: "Denormalized events land in 7-day chunks." },
  { icon: Layers3, title: "Four CAGGs", caption: "Hourly rollups refresh every 30 minutes." },
  { icon: BarChart3, title: "Dashboards", caption: "Flask reads rollups; React only renders." },
];

function formatMs(value) {
  if (value === null || value === undefined) return "—";
  if (value < 1) return `${Number(value).toFixed(2)} ms`;
  if (value < 100) return `${Number(value).toFixed(1)} ms`;
  return `${Math.round(Number(value))} ms`;
}

function formatSpeedup(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(2).replace(/\.?0+$/, "")}×`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

export default function AnalyticsSystem() {
  const storage = useFetch("/analytics/storage");
  const [days, setDays] = useState(cachedBenchmark?.window?.days || 90);
  const [iterations, setIterations] = useState(cachedBenchmark?.iterations || 5);
  const [benchmark, setBenchmark] = useState(cachedBenchmark);
  const [running, setRunning] = useState(false);
  const [benchError, setBenchError] = useState(null);
  const initialised = useRef(false);

  const runBenchmark = useCallback(
    async (nextDays = days, nextIterations = iterations) => {
      setRunning(true);
      setBenchError(null);
      try {
        const data = await api.post("/analytics/benchmark", {
          days: Number(nextDays),
          iterations: Number(nextIterations),
        });
        cachedBenchmark = data;
        setBenchmark(data);
      } catch (error) {
        setBenchError(error);
      } finally {
        setRunning(false);
      }
    },
    [days, iterations]
  );

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    if (!cachedBenchmark) runBenchmark(90, 5);
  }, [runBenchmark]);

  if (storage.error && !storage.data) {
    return <ErrorState error={storage.error} onRetry={storage.refresh} title="Storage metrics are unavailable" />;
  }
  if (!storage.data) return <AnalyticsLoading label="Inspecting both stores" />;

  const { timescale, mysql, sync } = storage.data;
  const { hypertable, chunks, compression, continuous_aggregates: caggs } = timescale;
  const ratio = compression.after_bytes ? compression.before_bytes / compression.after_bytes : 0;
  const reclaimed = compression.before_bytes - compression.after_bytes;
  const caggBytes = caggs.reduce((total, view) => total + Number(view.bytes), 0);
  const maxTableBytes = Math.max(...mysql.tables.map((table) => table.total_bytes), 1);

  const scenarios = benchmark
    ? Object.entries(benchmark.results).map(([key, result]) => ({
        key,
        short: SHORT_SCENARIO[key] || key,
        ...result,
      }))
    : [];
  const speedupData = scenarios.map((scenario) => ({
    name: scenario.short,
    "Raw events": scenario.raw_speedup ?? null,
    CAGGs: scenario.cagg_speedup ?? null,
  }));

  return (
    <>
      <div className="kpi-grid">
        <StatCard
          label="Hypertable footprint"
          value={hypertable.pretty}
          icon={Database}
          tone="saffron"
          sub={`${chunks.total} chunks · 7-day slices`}
        />
        <StatCard
          label="Compression ratio"
          value={ratio ? `${ratio.toFixed(1)}×` : "—"}
          icon={Archive}
          tone="green"
          sub={`${pct(compression.pct_of_original)} of original after 14 days`}
        />
        <StatCard
          label="Compressed chunks"
          value={`${chunks.compressed} / ${chunks.total}`}
          icon={Layers3}
          tone="violet"
          sub={`${chunks.uncompressed} newest stay write-optimized`}
        />
        <StatCard
          label="Outbox health"
          value={sync.pending ? `${sync.pending} pending` : "Caught up"}
          icon={ShieldCheck}
          tone="teal"
          sub={`${num(sync.processed)} projected · ${sync.failed} failed`}
        />
      </div>

      <Card className="pipeline-card">
        <CardHeader
          title="How an order becomes an analytic"
          subtitle="A transactional outbox keeps MySQL authoritative while TimescaleDB ingests the same facts"
          icon={ArrowRight}
          actions={
            <Badge tone={sync.pending ? "amber" : "green"} dot>
              {sync.pending ? `${sync.pending} waiting` : "Projector idle · caught up"}
            </Badge>
          }
        />
        <div className="pipeline">
          {PIPELINE.map((step, index) => (
            <div className="pipeline__piece" key={step.title}>
              <div className="pipeline__node">
                <span className="pipeline__icon">
                  <step.icon size={17} />
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.caption}</span>
                </div>
              </div>
              {index < PIPELINE.length - 1 ? (
                <span className="pipeline__arrow" aria-hidden="true">
                  <ArrowRight size={14} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="pipeline-foot">
          <span>
            <Gauge size={13} /> Last projected event {sync.last_processed_at ? fromNow(sync.last_processed_at) : "—"}
          </span>
          <span>
            <Boxes size={13} /> {num(sync.processed)} events drained from <code>analytics_outbox</code>
          </span>
          <span>
            <BadgeCheck size={13} /> Idempotent on <code>source_outbox_id</code>
          </span>
        </div>
      </Card>

      <div className="analytics-two-col analytics-two-col--storage">
        <Card>
          <CardHeader
            title="Columnar compression, in place"
            subtitle="TimescaleDB compresses chunks older than 14 days"
            icon={Archive}
            actions={<Badge tone="green">{chunks.compressed} chunks compressed</Badge>}
          />
          <div className="compression-figure">
            <div className="compression-row">
              <span className="compression-row__label">Before</span>
              <div className="compression-row__track">
                <span className="compression-row__fill is-before" style={{ width: "100%" }} />
              </div>
              <strong>{compression.before_pretty}</strong>
            </div>
            <div className="compression-row">
              <span className="compression-row__label">After</span>
              <div className="compression-row__track">
                <span
                  className="compression-row__fill is-after"
                  style={{ width: `${Math.max(compression.pct_of_original, 2.5)}%` }}
                />
              </div>
              <strong>{compression.after_pretty}</strong>
            </div>
            <div className="compression-callout">
              <span className="compression-callout__icon">
                <Zap size={16} />
              </span>
              <div>
                <strong>{formatBytes(reclaimed)} reclaimed</strong>
                <span>
                  {ratio ? `${ratio.toFixed(1)}× smaller than uncompressed chunks` : "Compression pending"} ·{" "}
                  {pct(100 - Number(compression.pct_of_original))} saved
                </span>
              </div>
            </div>
          </div>
          <div className="storage-facts">
            <div>
              <span>Retention</span>
              <strong>730 days</strong>
            </div>
            <div>
              <span>Chunk interval</span>
              <strong>7 days</strong>
            </div>
            <div>
              <span>CAGG storage</span>
              <strong>{formatBytes(caggBytes)}</strong>
            </div>
          </div>
          <AnalyticsNote icon={Archive}>
            Only cold chunks are compressed, so current writes continue against uncompressed row storage.
            Retention is configured but leaves two years of event history available.
          </AnalyticsNote>
        </Card>

        <Card className="chunk-card">
          <CardHeader
            title="Chunk inventory"
            subtitle={`${chunks.total} chunks · newest first`}
            icon={Boxes}
            actions={<Badge tone="neutral">TimescaleDB</Badge>}
          />
          <div className="table-wrap table-wrap--scroll chunk-scroll">
            <table className="data-table compact chunk-table">
              <thead>
                <tr>
                  <th>Chunk range</th>
                  <th>Status</th>
                  <th className="num">Before</th>
                  <th className="num">After</th>
                </tr>
              </thead>
              <tbody>
                {compression.chunk_details.map((chunk) => (
                  <tr key={chunk.chunk_name}>
                    <td>
                      <span className="chunk-range">
                        {formatDate(chunk.range_start, "short")} → {formatDate(chunk.range_end, "short")}
                      </span>
                      <span className="sub">{chunk.chunk_name}</span>
                    </td>
                    <td>
                      <Badge tone={chunk.compression_status === "Compressed" ? "green" : "amber"}>
                        {chunk.compression_status === "Compressed" ? "Compressed" : "Live"}
                      </Badge>
                    </td>
                    <td className="num">{chunk.before_pretty || "—"}</td>
                    <td className="num strong">{chunk.after_pretty || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="chunk-foot">
            {compression.chunk_details.length} chunks · updated live from <code>chunk_compression_stats()</code>
          </div>
        </Card>
      </div>

      <div className="analytics-two-col analytics-two-col--caggs">
        <Card>
          <CardHeader
            title="Continuous aggregates"
            subtitle="Hourly materializations aligned to Asia/Kolkata"
            icon={Layers3}
            actions={<Badge tone="green" dot>Real-time enabled</Badge>}
          />
          <div className="table-wrap">
            <table className="data-table compact cagg-table">
              <thead>
                <tr>
                  <th>View</th>
                  <th>Materialized hypertable</th>
                  <th className="num">Size</th>
                </tr>
              </thead>
              <tbody>
                {caggs.map((view) => (
                  <tr key={view.view_name}>
                    <td>
                      <code>{view.view_name}</code>
                    </td>
                    <td className="sub">{view.materialization_hypertable_name}</td>
                    <td className="num">{view.pretty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cagg-foot">
            <span>
              <Timer size={13} /> Refresh window: 3 days back, end offset 1 hour
            </span>
            <span>
              <RefreshCw size={13} /> Schedule: every 30 minutes
            </span>
          </div>
          <AnalyticsNote icon={Layers3}>
            The CAGGs hold bills, orders, payments and kitchen throughput. Live buckets are computed on read and
            unioned with materialized history.
          </AnalyticsNote>
        </Card>

        <Card>
          <CardHeader
            title="MySQL operational footprint"
            subtitle="Normalized tables in the source of truth"
            icon={Database}
            actions={<Badge tone="neutral">{mysql.total_pretty}</Badge>}
          />
          <div className="storage-bars">
            {mysql.tables.map((table) => (
              <div className="storage-bar" key={table.table_name}>
                <div className="storage-bar__head">
                  <span>
                    <strong>{table.table_name}</strong>
                    <small>{num(table.row_count)} rows</small>
                  </span>
                  <span className="storage-bar__value">{table.pretty}</span>
                </div>
                <div className="mini-bar">
                  <span
                    className="mini-bar__fill"
                    style={{ width: `${Math.max((table.total_bytes / maxTableBytes) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="storage-total">
            <span>Total across {mysql.tables.length} tables</span>
            <strong>{mysql.total_pretty}</strong>
          </div>
          <AnalyticsNote icon={Database}>
            The hypertable holds a denormalized copy of these facts, so analytics reads do not join across the
            operational schema.
          </AnalyticsNote>
        </Card>
      </div>

      <Card className="benchmark-card">
        <CardHeader
          title="MySQL vs TimescaleDB"
          subtitle="Interleaved median latency over warm runs on the same Docker host"
          icon={Gauge}
          actions={
            <div className="bench-controls">
              <Segmented
                size="sm"
                options={[
                  { value: 30, label: "30d" },
                  { value: 90, label: "90d" },
                  { value: 120, label: "120d" },
                ]}
                value={days}
                onChange={setDays}
              />
              <Segmented
                size="sm"
                options={[
                  { value: 3, label: "3×" },
                  { value: 5, label: "5×" },
                  { value: 10, label: "10×" },
                ]}
                value={iterations}
                onChange={setIterations}
              />
              <Button
                variant="dark"
                size="sm"
                icon={Play}
                loading={running}
                onClick={() => runBenchmark(days, iterations)}
              >
                {benchmark ? "Re-run" : "Run"}
              </Button>
            </div>
          }
        />

        {benchError ? (
          <div className="bench-error">
            <TriangleAlert size={17} />
            <div>
              <strong>Benchmark failed</strong>
              <p>{benchError.message}</p>
            </div>
          </div>
        ) : null}

        {!benchmark ? (
          benchError ? (
            <div className="bench-idle">
              <Gauge size={20} />
              <p>No benchmark results yet. Adjust the window above and press Run.</p>
            </div>
          ) : (
            <div className="bench-loading">
              <Loading label="Warming up both stores and timing the queries" rows={4} />
              <p>One warm-up run is discarded, then median latencies are collected from identical result sets.</p>
            </div>
          )
        ) : (
          <>
            <div className="bench-meta">
              <div>
                <span>Window</span>
                <strong>
                  {formatDate(benchmark.window.start, "short")} → {formatDate(benchmark.window.end, "short")}
                </strong>
                <small>{benchmark.window.days} restaurant days</small>
              </div>
              <div>
                <span>Dataset</span>
                <strong>{num(benchmark.dataset.events)} events</strong>
                <small>
                  {num(benchmark.dataset.mysql_bills)} bills · {benchmark.iterations} timed iterations
                </small>
              </div>
              <div>
                <span>Revenue reconciliation</span>
                <strong>{inr(benchmark.reconciliation.mysql_revenue)}</strong>
                <small>
                  TimescaleDB {inr(benchmark.reconciliation.timescale_revenue)} · difference{" "}
                  {inr(benchmark.reconciliation.difference, 2)}
                </small>
              </div>
              <span className={benchmark.reconciliation.matched ? "recon-seal is-ok" : "recon-seal is-bad"}>
                {benchmark.reconciliation.matched ? <BadgeCheck size={18} /> : <TriangleAlert size={18} />}
                <div>
                  <strong>{benchmark.reconciliation.matched ? "Exact match" : "Drift"}</strong>
                  <span>{benchmark.reconciliation.matched ? "same answers" : "check outbox"}</span>
                </div>
              </span>
            </div>

            <div className="analytics-two-col analytics-two-col--bench">
              <div className="bench-chart">
                <div className="bench-chart__head">
                  <div>
                    <h3>How much faster than MySQL</h3>
                    <p>Higher is better · median latency, same query result</p>
                  </div>
                  <ChartLegend
                    items={[
                      { label: "Raw events", color: CHART.toffee },
                      { label: "Continuous aggregate", color: CHART.olive },
                    ]}
                  />
                </div>
                <div className="chart-box" style={{ height: 256 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={speedupData} margin={{ top: 8, right: 12, bottom: 0, left: -10 }} barGap={6}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="name" {...axisProps} tickMargin={9} />
                      <YAxis {...axisProps} width={42} tickFormatter={(value) => `${value}×`} />
                      <Tooltip
                        content={
                          <ChartTip
                            valueFormatter={(value) => `${formatSpeedup(value)} faster than MySQL`}
                          />
                        }
                        cursor={{ fill: "rgba(201, 118, 26, 0.05)" }}
                      />
                      <Bar dataKey="Raw events" fill={CHART.toffee} radius={[4, 4, 0, 0]} maxBarSize={46} />
                      <Bar dataKey="CAGGs" fill={CHART.olive} radius={[4, 4, 0, 0]} maxBarSize={46} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bench-list">
                {scenarios.map((scenario) => (
                  <div className="bench-row" key={scenario.key}>
                    <div className="bench-row__head">
                      <strong>{scenario.name}</strong>
                      <Badge tone="neutral">{num(scenario.mysql.rows)} rows</Badge>
                    </div>
                    <div className="bench-times">
                      <div>
                        <span>MySQL</span>
                        <strong>{formatMs(scenario.mysql.median_ms)}</strong>
                        <small>{num(scenario.mysql.rows)} rows</small>
                      </div>
                      {scenario.timescale_raw ? (
                        <div>
                          <span>TS · raw events</span>
                          <strong>{formatMs(scenario.timescale_raw.median_ms)}</strong>
                          <small>{formatSpeedup(scenario.raw_speedup)} faster</small>
                        </div>
                      ) : null}
                      {scenario.timescale_cagg ? (
                        <div className="is-highlight">
                          <span>TS · continuous aggregate</span>
                          <strong>{formatMs(scenario.timescale_cagg.median_ms)}</strong>
                          <small>{formatSpeedup(scenario.cagg_speedup)} faster</small>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bench-notes">
              <span className="bench-notes__title">
                <TriangleAlert size={14} /> Read these numbers honestly
              </span>
              <ul>
                {benchmark.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </Card>

      <AnalyticsNote>
        Storage, chunk and outbox figures are read live from the databases over the API. The benchmark is triggered
        explicitly from this page so its cost never runs inside a dashboard poll.
      </AnalyticsNote>
    </>
  );
}
