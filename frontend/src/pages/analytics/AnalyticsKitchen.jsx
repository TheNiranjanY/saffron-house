import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ChefHat, Clock3, Flame, Gauge, Timer, TrendingUp } from "lucide-react";
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
import { CHART, ORDER_TYPE } from "../../lib/constants";
import { formatDate, formatDuration, formatTime, inr, num } from "../../lib/format";
import { axisProps, ChartLegend, ChartTip, gridProps } from "../../components/Charts";
import { Avatar, Badge, Card, CardHeader, ErrorState, StatCard } from "../../components/UI";
import { AnalyticsLoading, AnalyticsNote } from "./shared";

export default function AnalyticsKitchen({ days }) {
  const kitchen = useFetch(`/analytics/kitchen?days=${days}`);

  const series = useMemo(
    () => (kitchen.data?.series || []).map((row) => ({ ...row, label: formatDate(row.day, "short") })),
    [kitchen.data]
  );

  if (kitchen.error && !kitchen.data) {
    return <ErrorState error={kitchen.error} onRetry={kitchen.refresh} title="Kitchen analytics are unavailable" />;
  }
  if (!kitchen.data) return <AnalyticsLoading label="Reading kitchen events" />;

  const summary = kitchen.data.summary;
  const maxChefRevenue = Math.max(...kitchen.data.chefs.map((chef) => Number(chef.line_revenue)), 1);
  const maxPrep = Math.max(summary.avg_seconds, summary.median_seconds, summary.p95_seconds, summary.max_seconds);

  const slaBars = [
    { label: "Median", value: summary.median_seconds, tone: "green", note: "half of all orders" },
    { label: "Average", value: summary.avg_seconds, tone: "saffron", note: "mean preparation" },
    { label: "P95", value: summary.p95_seconds, tone: "amber", note: "slowest 1 in 20" },
    { label: "Maximum", value: summary.max_seconds, tone: "red", note: "single worst ticket" },
  ];

  return (
    <>
      <div className="kpi-grid">
        <StatCard
          label="Orders prepared"
          value={num(summary.prepared_orders)}
          icon={ChefHat}
          tone="saffron"
          sub={`${days}-day kitchen throughput`}
        />
        <StatCard
          label="Average prep"
          value={formatDuration(summary.avg_seconds)}
          icon={Timer}
          tone="green"
          sub="placed → prepared"
        />
        <StatCard
          label="Median prep"
          value={formatDuration(summary.median_seconds)}
          icon={Gauge}
          tone="violet"
          sub="the typical ticket"
        />
        <StatCard
          label="P95 prep"
          value={formatDuration(summary.p95_seconds)}
          icon={Flame}
          tone="red"
          sub="tail of the service"
        />
      </div>

      <div className="analytics-two-col analytics-two-col--kitchen">
        <Card>
          <CardHeader
            title="Kitchen throughput and pace"
            subtitle="Daily prepared orders against average prep time"
            icon={Clock3}
            actions={
              <ChartLegend
                items={[
                  { label: "Prepared", color: "#E3C08A" },
                  { label: "Avg prep", color: CHART.wine },
                ]}
              />
            }
          />
          <div className="chart-box" style={{ height: 305 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 10, right: 2, bottom: 0, left: -14 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={26} tickMargin={8} />
                <YAxis {...axisProps} width={44} allowDecimals={false} />
                <YAxis
                  yAxisId="time"
                  orientation="right"
                  {...axisProps}
                  width={48}
                  tickFormatter={(value) => `${Math.round(value / 60)}m`}
                />
                <Tooltip
                  content={
                    <ChartTip valueFormatter={(value, entry) => (entry.dataKey === "avg_seconds" ? formatDuration(value) : num(value))} />
                  }
                />
                <Bar dataKey="prepared" name="Prepared" fill="#E3C08A" radius={[4, 4, 0, 0]} maxBarSize={18} />
                <Line
                  yAxisId="time"
                  type="monotone"
                  dataKey="avg_seconds"
                  name="Avg prep"
                  stroke={CHART.wine}
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Prep-time envelope" subtitle="Distribution across the window" icon={Gauge} />
          <div className="sla-bars">
            {slaBars.map((bar) => (
              <div key={bar.label}>
                <div className="sla-bars__labels">
                  <span>{bar.label}</span>
                  <strong>{formatDuration(bar.value)}</strong>
                </div>
                <div className="sla-bars__track">
                  <span
                    className={`sla-bars__fill sla-bars__fill--${bar.tone}`}
                    style={{ width: `${Math.max((bar.value / maxPrep) * 100, 4)}%` }}
                  />
                </div>
                <small>{bar.note}</small>
              </div>
            ))}
          </div>
          <div className="sla-foot">
            <TrendingUp size={14} />
            <span>
              {summary.avg_seconds < summary.median_seconds
                ? "Fast tickets are pulling the average below the median."
                : "A long tail is lifting the average above the median."}
            </span>
          </div>
          <AnalyticsNote icon={Clock3}>
            Percentiles are computed from <code>prep_seconds</code> on prepared events, not from application timers.
          </AnalyticsNote>
        </Card>
      </div>

      <div className="analytics-two-col">
        <Card>
          <CardHeader title="Chefs on the line" subtitle="Item lines and revenue attributed by chef snapshot" icon={ChefHat} />
          <div className="chef-list">
            {kitchen.data.chefs.map((chef, index) => (
              <div className="chef-row" key={chef.chef_name}>
                <span className="chef-row__rank">{String(index + 1).padStart(2, "0")}</span>
                <Avatar name={chef.chef_name} className="avatar--saffron" />
                <div className="chef-row__body">
                  <div>
                    <strong>{chef.chef_name}</strong>
                    <span>{num(chef.lines)} lines · {num(chef.items)} plates</span>
                  </div>
                  <div className="mini-bar">
                    <span
                      className="mini-bar__fill"
                      style={{ width: `${(Number(chef.line_revenue) / maxChefRevenue) * 100}%` }}
                    />
                  </div>
                </div>
                <strong className="chef-row__revenue">{inr(chef.line_revenue)}</strong>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Slowest tickets"
            subtitle="Where the kitchen spent the longest"
            icon={Flame}
            actions={<Badge tone="red">Tail watch</Badge>}
          />
          <div className="slow-list">
            {kitchen.data.slowest.map((order) => (
              <div className="slow-row" key={`${order.order_id}-${order.event_time}`}>
                <span className="slow-row__time">{formatDuration(order.prep_seconds)}</span>
                <div className="slow-row__body">
                  <div>
                    <Link to={`/orders/${order.order_id}`}>Order #{order.order_id}</Link>
                    <Badge tone={ORDER_TYPE[order.order_type]?.tone || "neutral"}>
                      {ORDER_TYPE[order.order_type]?.label || order.order_type}
                    </Badge>
                  </div>
                  <span>{order.waiter_name || "Unassigned"} · prepared {formatTime(order.event_time)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <AnalyticsNote>
        Kitchen events carry the chef name and preparation seconds at write time, so this view needs no cross-database join. The <code>kitchen_performance_hourly</code> CAGG maintains these rollups incrementally.
      </AnalyticsNote>
    </>
  );
}
