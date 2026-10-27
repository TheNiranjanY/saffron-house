import { useMemo } from "react";
import { BadgeCheck, CalendarRange, Clock3, IndianRupee, Receipt, TrendingUp, Wallet } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFetch } from "../../lib/api";
import { CHART } from "../../lib/constants";
import { DOW_LABELS, formatDate, hourLabel, inr, num } from "../../lib/format";
import { axisProps, ChartLegend, ChartTip, gridProps, moneyTick } from "../../components/Charts";
import { Badge, Card, CardHeader, ErrorState, StatCard } from "../../components/UI";
import { AnalyticsLoading, AnalyticsNote } from "./shared";

const HOURS = Array.from({ length: 15 }, (_, index) => index + 9);

function shortHour(hour) {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

export default function AnalyticsRevenue({ days }) {
  const series = useFetch(`/analytics/revenue-series?days=${days}`);
  const peak = useFetch(`/analytics/peak-hours?days=${days}`);
  const dashboard = useFetch(`/analytics/dashboard?days=${days}`);

  const chartData = useMemo(
    () =>
      (series.data?.series || []).map((row) => ({
        ...row,
        label: formatDate(row.date, "short"),
      })),
    [series.data]
  );

  const cells = peak.data?.cells || [];
  const totalBills = series.data?.series?.reduce((total, row) => total + Number(row.mysql_bills), 0) || 0;
  const maxRevenue = Math.max(...cells.map((cell) => Number(cell.revenue)), 1);
  const cellMap = useMemo(
    () => Object.fromEntries(cells.map((cell) => [`${cell.dow}-${cell.hour}`, cell])),
    [cells]
  );
  const topSlots = useMemo(
    () =>
      [...cells]
        .filter((cell) => cell.revenue > 0)
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, 6),
    [cells]
  );
  const busiest = topSlots[0];

  if (series.error && !series.data) {
    return <ErrorState error={series.error} onRetry={series.refresh} title="Revenue analytics are unavailable" />;
  }
  if (!series.data) return <AnalyticsLoading label="Reading daily revenue" />;

  const kpis = dashboard.data?.kpis;

  return (
    <>
      <div className="kpi-grid">
        <StatCard
          label={`Revenue · ${days} days`}
          value={inr(kpis?.revenue?.value ?? series.data.totals.mysql)}
          icon={IndianRupee}
          tone="saffron"
          trend={kpis?.revenue?.change_pct}
          sub="recognised at bill generation"
        />
        <StatCard
          label="Bills"
          value={num(kpis?.bills?.value ?? totalBills)}
          icon={Receipt}
          tone="violet"
          trend={kpis?.bills?.change_pct}
          sub="closed service tickets"
        />
        <StatCard
          label="Average bill"
          value={inr(kpis?.avg_bill?.value ?? (totalBills ? series.data.totals.mysql / totalBills : 0))}
          icon={TrendingUp}
          tone="green"
          trend={kpis?.avg_bill?.change_pct}
          sub="per generated bill"
        />
        <StatCard
          label="Collected"
          value={inr(kpis?.collected?.value ?? 0)}
          icon={Wallet}
          tone="teal"
          trend={kpis?.collected?.change_pct}
          sub="payments received in period"
        />
      </div>

      <Card className="revenue-card">
        <CardHeader
          title="Daily revenue, reconciled live"
          subtitle={`${formatDate(series.data.start, "short")} → ${formatDate(series.data.end, "short")} · restaurant-local days`}
          icon={CalendarRange}
          actions={
            <ChartLegend
              items={[
                { label: "MySQL ledger", color: "#E3C08A" },
                { label: "TimescaleDB events", color: CHART.olive },
              ]}
            />
          }
        />
        <div className="chart-box" style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: -8 }} barCategoryGap={days > 60 ? "18%" : "32%"}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} tickMargin={9} minTickGap={14} />
              <YAxis {...axisProps} tickFormatter={moneyTick} width={58} />
              <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(201, 118, 26, 0.05)" }} />
              <Bar dataKey="mysql_revenue" name="MySQL" fill="#E3C08A" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line
                type="monotone"
                dataKey="timescale_revenue"
                name="TimescaleDB"
                stroke={CHART.olive}
                strokeWidth={2.1}
                dot={false}
                activeDot={{ r: 4, stroke: "#fffaf1", strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="revenue-recon">
          <div className="revenue-recon__values">
            <div>
              <span>MySQL bills ledger</span>
              <strong>{inr(series.data.totals.mysql)}</strong>
              <small>{num(totalBills)} bills across {chartData.length} days</small>
            </div>
            <div>
              <span>TimescaleDB event stream</span>
              <strong>{inr(series.data.totals.timescale)}</strong>
              <small>BILL_GENERATED events in the hypertable</small>
            </div>
            <div>
              <span>Difference</span>
              <strong>{inr(series.data.totals.difference, 2)}</strong>
              <small>{series.data.totals.matched ? "exact row-for-row agreement" : "investigate the outbox"}</small>
            </div>
          </div>
          <div className={series.data.totals.matched ? "recon-seal is-ok" : "recon-seal is-bad"}>
            <BadgeCheck size={18} />
            <div>
              <strong>{series.data.totals.matched ? "Sources agree" : "Drift detected"}</strong>
              <span>{series.data.totals.matched ? "MySQL ≡ TimescaleDB" : "Check pending events"}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="analytics-two-col analytics-two-col--heatmap">
        <Card className="heatmap-card">
          <CardHeader
            title="When the room fills"
            subtitle="Revenue by weekday and hour · darker means busier"
            icon={Clock3}
            actions={
              <div className="heatmap-scale">
                <span>Quiet</span>
                <i />
                <span>Busy</span>
              </div>
            }
          />
          {peak.loading && !peak.data ? (
            <div className="chart-skeleton" style={{ height: 265 }}><span /><span /><span /><span /></div>
          ) : peak.error && !peak.data ? (
            <ErrorState error={peak.error} onRetry={peak.refresh} title="Heatmap unavailable" />
          ) : (
            <>
              <div className="heatmap-scroll">
                <div className="heatmap" style={{ gridTemplateColumns: `54px repeat(${HOURS.length}, minmax(36px, 1fr))` }}>
                  <span />
                  {HOURS.map((hour) => (
                    <span className="heatmap__hour" key={hour}>{shortHour(hour)}</span>
                  ))}
                  {DOW_LABELS.map((day, index) => {
                    const dow = index + 1;
                    return (
                      <Row
                        key={day}
                        day={day}
                        dow={dow}
                        cellMap={cellMap}
                        maxRevenue={maxRevenue}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="heatmap-foot">
                <Badge tone="saffron">Asia/Kolkata buckets</Badge>
                <span>
                  Busiest window: <strong>{busiest ? `${DOW_LABELS[busiest.dow - 1]} · ${hourLabel(busiest.hour)}` : "—"}</strong>
                  {busiest ? ` · ${inr(busiest.revenue)}` : ""}
                </span>
              </div>
            </>
          )}
        </Card>

        <Card className="busiest-card">
          <CardHeader title="Windows worth staffing" subtitle="Highest-grossing weekday slots" />
          <ol className="busiest-list">
            {topSlots.map((slot, index) => (
              <li key={`${slot.dow}-${slot.hour}`}>
                <span className={index === 0 ? "busiest-list__rank is-first" : "busiest-list__rank"}>{index + 1}</span>
                <div className="busiest-list__body">
                  <div>
                    <strong>{DOW_LABELS[slot.dow - 1]}</strong>
                    <span>{hourLabel(slot.hour)}</span>
                    <small>{slot.bills} bills</small>
                  </div>
                  <span className="busiest-list__value">{inr(slot.revenue)}</span>
                  <div className="mini-bar">
                    <span className="mini-bar__fill" style={{ width: `${(Number(slot.revenue) / Math.max(Number(busiest?.revenue || 1), 1)) * 100}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <AnalyticsNote icon={Clock3}>
            Built with <code>time_bucket_gapfill</code> in SQL Lab; quiet hours stay on the axis instead of silently disappearing.
          </AnalyticsNote>
        </Card>
      </div>

      <AnalyticsNote>
        This view reads the <code>sales_hourly</code> continuous aggregate with real-time aggregation enabled. Recent bills appear immediately while historical buckets stay materialized and compressed.
      </AnalyticsNote>
    </>
  );
}

function Row({ day, dow, cellMap, maxRevenue }) {
  return (
    <>
      <span className="heatmap__day">{day}</span>
      {HOURS.map((hour) => {
        const cell = cellMap[`${dow}-${hour}`];
        const ratio = cell ? Number(cell.revenue) / maxRevenue : 0;
        const style = {
          background: cell
            ? `rgba(201, 118, 26, ${0.07 + ratio * 0.88})`
            : "rgba(240, 231, 216, 0.35)",
          color: ratio > 0.52 ? "#fff8ec" : "var(--ink-soft)",
        };
        const tip = cell
          ? `${day} ${hourLabel(hour)} · ${inr(cell.revenue)} · ${cell.bills} bills`
          : `${day} ${hourLabel(hour)} · no bills`;
        return (
          <span
            key={hour}
            className={cell ? "heatmap__cell" : "heatmap__cell is-empty"}
            style={style}
            data-tip={tip}
            title={tip}
          >
            {cell && ratio > 0.55 ? Math.round(Number(cell.revenue) / 1000) : ""}
          </span>
        );
      })}
    </>
  );
}
