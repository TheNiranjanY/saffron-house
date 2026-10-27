import { useMemo } from "react";
import { ArrowRight, ChefHat, CircleSlash, Layers, TrendingUp, Utensils } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFetch } from "../../lib/api";
import { CHART, DONUT_COLORS, ORDER_TYPE } from "../../lib/constants";
import { formatDate, inr, inrCompact, num, pct } from "../../lib/format";
import { axisProps, ChartLegend, ChartTip, gridProps, moneyTick } from "../../components/Charts";
import { Badge, Card, CardHeader, ErrorState, StatCard } from "../../components/UI";
import { AnalyticsLoading, AnalyticsNote } from "./shared";

export default function AnalyticsMenu({ days }) {
  const top = useFetch(`/analytics/top-items?days=${days}&limit=10`);
  const flow = useFetch(`/analytics/order-flow?days=${days}`);

  const flowSeries = useMemo(
    () => (flow.data?.daily || []).map((row) => ({ ...row, label: formatDate(row.day, "short") })),
    [flow.data]
  );

  if (top.error && !top.data) {
    return <ErrorState error={top.error} onRetry={top.refresh} title="Menu analytics are unavailable" />;
  }
  if (!top.data) return <AnalyticsLoading label="Ranking dishes" />;
  if (flow.error && !flow.data) {
    return <ErrorState error={flow.error} onRetry={flow.refresh} title="Order flow is unavailable" />;
  }
  if (!flow.data) return <AnalyticsLoading label="Tracing order flow" />;

  const funnel = flow.data.funnel;
  const items = top.data.items;
  const steps = [
    { label: "Placed", value: funnel.placed, tone: "placed" },
    { label: "Prepared", value: funnel.prepared, tone: "prepared" },
    { label: "Billed", value: funnel.billed, tone: "billed" },
    { label: "Closed", value: funnel.closed, tone: "closed" },
  ];
  const placed = funnel.placed || 1;

  return (
    <>
      <div className="kpi-grid">
        <StatCard
          label="Units sold"
          value={num(top.data.totals.units)}
          icon={Utensils}
          tone="saffron"
          sub={`${top.data.items.length} leading dishes shown`}
        />
        <StatCard
          label="Menu revenue"
          value={inr(top.data.totals.revenue)}
          icon={TrendingUp}
          tone="green"
          sub="attributed to item lines"
        />
        <StatCard
          label="Completion rate"
          value={funnel ? pct(funnel.closure_rate_pct) : "—"}
          icon={ArrowRight}
          tone="violet"
          sub="placed → closed orders"
        />
        <StatCard
          label="Cancellation rate"
          value={funnel ? pct(funnel.cancellation_rate_pct) : "—"}
          icon={CircleSlash}
          tone="red"
          sub={`${num(funnel?.cancelled || 0)} cancelled in period`}
        />
      </div>

      <div className="analytics-two-col analytics-two-col--menu">
        <Card>
          <CardHeader
            title="The dishes that carry service"
            subtitle={`Top 10 by revenue · ${days} days`}
            icon={ChefHat}
            actions={<Badge tone="saffron">{num(top.data.totals.units)} units</Badge>}
          />
          <div className="chart-box" style={{ height: 365 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={items} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid {...gridProps} vertical horizontal={false} />
                <XAxis type="number" {...axisProps} tickFormatter={moneyTick} tickMargin={6} />
                <YAxis
                  type="category"
                  dataKey="item_name"
                  {...axisProps}
                  width={160}
                  tick={{ fill: CHART.espresso, fontSize: 11 }}
                  tickMargin={4}
                />
                <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(201, 118, 26, 0.05)" }} />
                <Bar dataKey="revenue" name="Revenue" fill={CHART.saffron} radius={[0, 5, 5, 0]} barSize={19}>
                  {items.map((item, index) => (
                    <Cell key={item.item_name} fill={index === 0 ? CHART.saffron : index < 3 ? "#D99848" : "#E4C69A"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="top-items-foot">
            <span>Top dish: <strong>{items[0]?.item_name}</strong> · {num(items[0]?.quantity)} sold</span>
            <span>{pct(items[0]?.share_pct)} of menu revenue</span>
          </div>
        </Card>

        <Card>
          <CardHeader title="Category mix" subtitle="Where revenue comes from" icon={Layers} />
          <div className="donut donut--wide">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={top.data.categories}
                  dataKey="revenue"
                  nameKey="category_name"
                  innerRadius="58%"
                  outerRadius="88%"
                  paddingAngle={2.5}
                  stroke="none"
                >
                  {top.data.categories.map((category, index) => (
                    <Cell key={category.category_name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut__center">
              <span>Menu revenue</span>
              <strong>{inrCompact(top.data.totals.revenue)}</strong>
            </div>
          </div>
          <ul className="legend-list legend-list--compact">
            {top.data.categories.map((category, index) => (
              <li key={category.category_name}>
                <span className="legend-list__dot" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                <div className="legend-list__text">
                  <span>{category.category_name}</span>
                  <small>{num(category.quantity)} plates</small>
                </div>
                <strong>{pct((Number(category.revenue) / Math.max(Number(top.data.totals.revenue), 1)) * 100)}</strong>
              </li>
            ))}
          </ul>
          <div className="category-revenue-note">
            <span>Average revenue per category</span>
            <strong>{inr(Number(top.data.totals.revenue) / Math.max(top.data.categories.length, 1))}</strong>
          </div>
        </Card>
      </div>

      <div className="analytics-two-col analytics-two-col--flow">
        <Card>
          <CardHeader title="Order funnel" subtitle="How tickets move through service" icon={ArrowRight} />
          <div className="funnel">
            {steps.map((step) => {
              const ratio = (step.value / placed) * 100;
              return (
                <div className="funnel__row" key={step.label}>
                  <div className="funnel__labels">
                    <span>{step.label}</span>
                    <strong>{num(step.value)}</strong>
                  </div>
                  <div className="funnel__track">
                    <span className={`funnel__bar funnel__bar--${step.tone}`} style={{ width: `${Math.max(ratio, 3)}%` }}>
                      {ratio >= 18 ? pct(ratio, 0) : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="funnel__summary">
            <div>
              <span>Cancellations</span>
              <strong>{num(funnel.cancelled)}</strong>
              <small>{pct(funnel.cancellation_rate_pct)} of placed</small>
            </div>
            <div>
              <span>Order types</span>
              <div className="order-type-pills">
                {flow.data.order_types.map((row) => (
                  <span key={row.order_type}>
                    {ORDER_TYPE[row.order_type]?.label || row.order_type} <strong>{num(row.orders)}</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Daily order flow"
            subtitle="Placed, prepared and closed each day"
            icon={Layers}
            actions={
              <ChartLegend
                items={[
                  { label: "Placed", color: CHART.saffron },
                  { label: "Prepared", color: CHART.olive },
                  { label: "Closed", color: CHART.espresso },
                ]}
              />
            }
          />
          <div className="chart-box" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={flowSeries} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={28} tickMargin={8} />
                <YAxis {...axisProps} width={48} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="placed" name="Placed" stroke={CHART.saffron} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="prepared" name="Prepared" stroke={CHART.olive} strokeWidth={1.7} dot={false} />
                <Line type="monotone" dataKey="closed" name="Closed" stroke={CHART.espresso} strokeWidth={1.7} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <AnalyticsNote>
        Item, quantity and amount are snapshotted onto each event at write time. That denormalization lets TimescaleDB answer “which dish carries revenue?” without joining back to MySQL.
      </AnalyticsNote>
    </>
  );
}
