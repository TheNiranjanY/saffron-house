import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  ChefHat,
  Clock3,
  IndianRupee,
  RefreshCw,
  Receipt,
  TrendingUp,
  Utensils,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFetch } from "../lib/api";
import { ORDER_TYPE, PAYMENT_MODE, CHART, DONUT_COLORS, EVENT_LABEL, EVENT_TONE } from "../lib/constants";
import { formatDate, formatTime, fromNow, greeting, inr, inrCompact, num } from "../lib/format";
import { cx } from "../lib/utils";
import { axisProps, ChartLegend, ChartTip, gridProps, moneyTick } from "../components/Charts";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Segmented,
  StatCard,
  StatusBadge,
} from "../components/UI";

const RANGES = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

function DashboardSkeleton() {
  return (
    <>
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((item) => (
          <Card className="stat" key={item}>
            <Loading label={item === 0 ? "Reading both stores" : "Loading"} rows={3} />
          </Card>
        ))}
      </div>
      <div className="dashboard-main">
        <Card>
          <Loading label="Building revenue series" rows={6} />
        </Card>
        <Card>
          <Loading label="Checking the room" rows={5} />
        </Card>
      </div>
    </>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useFetch(`/analytics/dashboard?days=${days}`, { poll: 20000 });

  const kpis = data?.kpis;
  const reconciliation = data?.reconciliation;
  const collected = data?.payment_mix?.reduce((total, row) => total + Number(row.amount), 0) || 0;
  const tablePercent = kpis ? Math.round((kpis.occupied_tables / Math.max(kpis.total_tables, 1)) * 100) : 0;

  return (
    <div className="page dashboard">
      <PageHeader
        eyebrow={`${formatDate(new Date(), "long")} · live service`}
        title={`${greeting()}, service team.`}
        description="One operational truth in MySQL, one analytical lens in TimescaleDB. Watch the room, settle bills and keep both stores in step."
        actions={
          <>
            <Segmented options={RANGES} value={days} onChange={setDays} />
            <button type="button" className="icon-btn" onClick={refresh} aria-label="Refresh dashboard" title="Refresh">
              <RefreshCw size={15} className={loading && data ? "spin" : ""} />
            </button>
            <Link to="/floor" className="btn btn--outline">
              <Utensils size={15} />
              <span>Table floor</span>
            </Link>
            <Link to="/pos" className="btn btn--primary">
              <Receipt size={15} />
              <span>New order</span>
            </Link>
          </>
        }
      />

      {!data && error ? (
        <ErrorState error={error} onRetry={refresh} title="The dashboard is out of reach" />
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="kpi-grid">
            <StatCard
              label={`Revenue · ${data.range.label.toLowerCase()}`}
              value={inr(kpis.revenue.value)}
              icon={IndianRupee}
              tone="saffron"
              trend={kpis.revenue.change_pct}
              sub={`vs ${inrCompact(kpis.revenue.previous)} previous period`}
            />
            <StatCard
              label="Bills settled"
              value={num(kpis.bills.value)}
              icon={Receipt}
              tone="green"
              trend={kpis.bills.change_pct}
              sub={`${num(kpis.payments.value)} payments taken`}
            />
            <StatCard
              label="Average bill"
              value={inr(kpis.avg_bill.value)}
              icon={TrendingUp}
              tone="violet"
              trend={kpis.avg_bill.change_pct}
              sub={`${formatDurationish(kpis.avg_prep_seconds.value)} avg kitchen time`}
            />
            <StatCard
              label="Payments collected"
              value={inr(kpis.collected.value)}
              icon={Wallet}
              tone="teal"
              trend={kpis.collected.change_pct}
              sub={`${num(kpis.open_orders)} open orders right now`}
            />
          </div>

          <div className="dashboard-main">
            <Card className="dashboard-chart-card">
              <CardHeader
                title="Today’s rhythm"
                subtitle="Revenue by hour, straight from the live sales aggregate"
                icon={Clock3}
                actions={
                  <div className="chart-head-total">
                    <span>Today</span>
                    <strong>{inr(data.today.revenue)}</strong>
                    <small>{data.today.bills} bills</small>
                  </div>
                }
              />
              <div className="chart-box" style={{ height: 248 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.hourly} margin={{ top: 8, right: 22, bottom: 0, left: -12 }}>
                    <defs>
                      <linearGradient id="dashboard-revenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.saffron} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={CHART.saffron} stopOpacity={0.015} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval={1} tickMargin={8} />
                    <YAxis {...axisProps} tickFormatter={moneyTick} width={58} tickMargin={4} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: CHART.saffron, strokeDasharray: "4 4", strokeOpacity: 0.4 }} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Revenue"
                      stroke={CHART.saffron}
                      strokeWidth={2.2}
                      fill="url(#dashboard-revenue)"
                      activeDot={{ r: 4, fill: CHART.saffron, stroke: "#fffaf1", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="card-footer card-footer--flat">
                <ChartLegend items={[{ label: "Revenue (Asia/Kolkata buckets)", color: CHART.saffron }]} />
                <span>{data.hourly.reduce((total, row) => total + row.bills, 0)} bills in today’s window</span>
              </div>
            </Card>

            <Card className="live-card card--dark">
              <div className="live-card__top">
                <div>
                  <p className="live-card__eyebrow">Live room</p>
                  <h2>Dinner service</h2>
                </div>
                <span className="live-flag">
                  <span className="pulse-dot is-live" />
                  Live
                </span>
              </div>

              <div className="live-stats">
                <div>
                  <strong>{num(kpis.open_orders)}</strong>
                  <span>open orders</span>
                </div>
                <div>
                  <strong>{num(kpis.occupied_tables)}<small>/{kpis.total_tables}</small></strong>
                  <span>tables seated</span>
                </div>
                <div>
                  <strong>{formatDurationish(kpis.avg_prep_seconds.value)}</strong>
                  <span>avg prep</span>
                </div>
              </div>

              <div className="occupancy">
                <div className="occupancy__label">
                  <span>Room occupancy</span>
                  <strong>{tablePercent}%</strong>
                </div>
                <div className="occupancy__bar">
                  <span style={{ width: `${Math.min(tablePercent, 100)}%` }} />
                </div>
              </div>

              <div className="live-statuses">
                {data.today_status
                  .filter((row) => ["PLACED", "PREPARING", "PREPARED", "BILLED"].includes(row.status))
                  .map((row) => (
                    <span key={row.status} className="live-status">
                      <StatusBadge value={row.status} />
                      <strong>{row.count}</strong>
                    </span>
                  ))}
              </div>

              <div className="live-card__footer">
                <Link to="/floor" className="live-link">
                  Open table floor <ArrowRight size={14} />
                </Link>
                <span>{num(kpis.cancelled.value)} cancelled this period</span>
              </div>
            </Card>
          </div>

          <div className="dashboard-secondary">
            <Card>
              <CardHeader
                title="Guest favourites"
                subtitle={`Top sellers · ${data.range.label.toLowerCase()}`}
                icon={ChefHat}
                actions={<Badge tone="saffron">{data.top_items.length} dishes</Badge>}
              />
              <ol className="rank-list">
                {data.top_items.map((item, index) => (
                  <li key={item.item_name}>
                    <span className={cx("rank-list__index", index === 0 && "is-first")}>{String(index + 1).padStart(2, "0")}</span>
                    <div className="rank-list__body">
                      <div className="rank-list__line">
                        <span className="rank-list__name">{item.item_name}</span>
                        <strong>{inr(item.revenue)}</strong>
                      </div>
                      <div className="rank-list__meta">
                        <span>{item.category_name}</span>
                        <span>{num(item.quantity)} sold</span>
                      </div>
                      <div className="rank-list__bar">
                        <span style={{ width: `${(item.quantity / Math.max(...data.top_items.map((row) => row.quantity), 1)) * 100}%` }} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>

            <Card>
              <CardHeader title="How guests paid" subtitle={`${num(kpis.payments.value)} successful payments`} icon={Wallet} />
              <div className="payment-mix">
                <div className="donut">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.payment_mix}
                        dataKey="amount"
                        nameKey="payment_mode"
                        innerRadius="66%"
                        outerRadius="94%"
                        paddingAngle={3}
                        stroke="none"
                      >
                        {data.payment_mix.map((row, index) => (
                          <Cell key={row.payment_mode} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut__center">
                    <span>Collected</span>
                    <strong>{inrCompact(collected)}</strong>
                  </div>
                </div>
                <ul className="legend-list">
                  {data.payment_mix.map((row, index) => (
                    <li key={row.payment_mode}>
                      <span className="legend-list__dot" style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }} />
                      <div className="legend-list__text">
                        <span>{PAYMENT_MODE[row.payment_mode]?.label || row.payment_mode}</span>
                        <small>{num(row.payments)} payments</small>
                      </div>
                      <strong>{inr(row.amount)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="order-type-strip">
                {data.order_types.map((row) => (
                  <div key={row.order_type}>
                    <span>{ORDER_TYPE[row.order_type]?.label || row.order_type}</span>
                    <strong>{num(row.orders)}</strong>
                  </div>
                ))}
              </div>
            </Card>

            <Card className={cx("recon-card", reconciliation.matched && "is-matched")}>
              <CardHeader title="Two stores, one truth" subtitle="Reconciled on every dashboard load" icon={BadgeCheck} />
              <div className={cx("recon-seal", reconciliation.matched ? "is-ok" : "is-bad")}>
                {reconciliation.matched ? <BadgeCheck size={19} /> : <RefreshCw size={19} />}
                <div>
                  <strong>{reconciliation.matched ? "Stores agree" : "Reconciliation drift"}</strong>
                  <span>{reconciliation.matched ? "Zero revenue difference" : `${inr(reconciliation.revenue_difference)} difference`}</span>
                </div>
              </div>
              <div className="recon-rows">
                <div>
                  <span>MySQL · bills</span>
                  <strong>{inr(reconciliation.mysql.revenue)}</strong>
                  <small>{num(reconciliation.mysql.bills)} bills</small>
                </div>
                <div>
                  <span>TimescaleDB · events</span>
                  <strong>{inr(reconciliation.timescale.revenue)}</strong>
                  <small>{num(reconciliation.timescale.bills)} bills</small>
                </div>
              </div>
              <div className="recon-foot">
                <span className={cx("recon-dot", reconciliation.pending_events === 0 ? "is-ok" : "is-warn")} />
                {reconciliation.pending_events === 0
                  ? "Outbox fully projected"
                  : `${reconciliation.pending_events} events awaiting projection`}
                <Link to="/analytics?tab=system" className="link">
                  Pipeline <ArrowUpRight size={12} />
                </Link>
              </div>
            </Card>
          </div>

          <div className="dashboard-lower">
            <Card className="table-card">
              <div className="table-card__header">
                <CardHeader
                  title="Orders in motion"
                  subtitle="Placed, preparing, prepared and awaiting settlement"
                  actions={<Link to="/orders" className="link">All orders <ArrowRight size={13} /></Link>}
                />
              </div>
              {data.active_orders.length === 0 ? (
                <EmptyState icon={Receipt} title="No active orders" description="The floor is quiet. Start a new order from the POS." />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Type</th>
                        <th>Waiter</th>
                        <th className="num">Items</th>
                        <th>Status</th>
                        <th className="num">Subtotal</th>
                        <th>Placed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.active_orders.map((order) => (
                        <tr key={order.order_id} className="is-clickable" onClick={() => navigate(`/orders/${order.order_id}`)}>
                          <td>
                            <Link to={`/orders/${order.order_id}`} className="strong">
                              #{order.order_id}
                            </Link>
                            <span className="sub">{order.table_id ? `Table ${order.table_id}` : ORDER_TYPE[order.order_type]?.label}</span>
                          </td>
                          <td>
                            <Badge tone={ORDER_TYPE[order.order_type]?.tone || "neutral"}>{ORDER_TYPE[order.order_type]?.label || order.order_type}</Badge>
                          </td>
                          <td>{order.waiter_name}</td>
                          <td className="num">{order.item_count}</td>
                          <td><StatusBadge value={order.status} /></td>
                          <td className="num strong">{inr(order.subtotal)}</td>
                          <td className="muted nowrap">{formatTime(order.placed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="event-card">
              <CardHeader
                title="Event stream"
                subtitle="The same events that feed TimescaleDB"
                icon={ArrowUpRight}
                actions={<Badge tone="teal" dot>streaming</Badge>}
              />
              <ul className="event-list">
                {data.recent_events.slice(0, 7).map((event, index) => (
                  <li key={`${event.event_time}-${index}`}>
                    <span className={cx("event-list__dot", `tone-${EVENT_TONE[event.event_type] || "neutral"}`)} />
                    <div className="event-list__body">
                      <div className="event-list__title">
                        <span>{EVENT_LABEL[event.event_type] || event.event_type}</span>
                        {event.amount ? <strong>{inr(event.amount)}</strong> : null}
                      </div>
                      <p>
                        <Link to={`/orders/${event.order_id}`}>Order #{event.order_id}</Link>
                        {event.table_id ? ` · Table ${event.table_id}` : ""}
                        {event.waiter_name ? ` · ${event.waiter_name}` : ""}
                        {event.item_name ? ` · ${event.item_name}` : ""}
                        {event.payment_mode ? ` · ${event.payment_mode}` : ""}
                      </p>
                    </div>
                    <time>{fromNow(event.event_time)}</time>
                  </li>
                ))}
              </ul>
              <div className="event-card__foot">
                <span>Partial index on the hypertable · 7-day chunks</span>
                <Link to="/sql" className="link">Open SQL Lab <ArrowRight size={12} /></Link>
              </div>
            </Card>
          </div>

          <div className="dashboard-footnote">
            <CalendarDays size={14} />
            <span>
              {data.range.label} · {formatDate(data.range.start, "short")} → {formatDate(data.range.end, "short")} in Asia/Kolkata. Revenue is recognised when a bill is generated; collections are payments received.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function formatDurationish(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const minutes = Math.round(Number(seconds) / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
