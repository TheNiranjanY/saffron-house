import { useMemo } from "react";
import {
  BadgeCheck,
  Banknote,
  CreditCard,
  Gauge,
  IndianRupee,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useFetch } from "../../lib/api";
import { CHART, PAYMENT_MODE } from "../../lib/constants";
import { formatDate, inr, num, pct } from "../../lib/format";
import { axisProps, ChartLegend, ChartTip, gridProps, moneyTick } from "../../components/Charts";
import { Badge, Card, CardHeader, ErrorState, StatCard } from "../../components/UI";
import { AnalyticsLoading, AnalyticsNote } from "./shared";

const MODES = ["CASH", "CARD", "UPI", "ONLINE"];

export default function AnalyticsPayments({ days }) {
  const payments = useFetch(`/analytics/payments?days=${days}`);

  const series = useMemo(
    () =>
      (payments.data?.daily || []).map((row) => ({
        ...row,
        label: formatDate(row.day, "short"),
      })),
    [payments.data]
  );

  if (payments.error && !payments.data) {
    return <ErrorState error={payments.error} onRetry={payments.refresh} title="Payment analytics are unavailable" />;
  }
  if (!payments.data) return <AnalyticsLoading label="Reading payment events" />;

  const { summary, mix } = payments.data;
  const totalCollected = Number(summary.collected);
  const digital = mix
    .filter((row) => row.payment_mode !== "CASH")
    .reduce((total, row) => total + Number(row.amount), 0);
  const digitalShare = totalCollected ? (digital / totalCollected) * 100 : 0;
  const efficiency = Math.min(Number(summary.collection_efficiency_pct), 100);
  const largest = Math.max(...payments.data.daily.map((row) => Number(row.collected)), 1);

  return (
    <>
      <div className="kpi-grid">
        <StatCard
          label={`Collected · ${days} days`}
          value={inr(summary.collected)}
          icon={Wallet}
          tone="saffron"
          sub="cash, card, UPI and online"
        />
        <StatCard
          label="Payments received"
          value={num(summary.payments)}
          icon={Receipt}
          tone="violet"
          sub="individual settlement entries"
        />
        <StatCard
          label="Average payment"
          value={inr(summary.avg_payment)}
          icon={TrendingUp}
          tone="green"
          sub="per payment, not per bill"
        />
        <StatCard
          label="Collection efficiency"
          value={pct(summary.collection_efficiency_pct)}
          icon={BadgeCheck}
          tone="teal"
          sub="collected against billed revenue"
        />
      </div>

      <div className="analytics-two-col analytics-two-col--payments">
        <Card>
          <CardHeader
            title="Daily settlement rhythm"
            subtitle="Collected value, split by payment mode"
            icon={Banknote}
            actions={
              <ChartLegend
                items={MODES.map((mode) => ({
                  label: PAYMENT_MODE[mode].label,
                  color: PAYMENT_MODE[mode].color,
                }))}
              />
            }
          />
          <div className="chart-box" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 12, right: 8, bottom: 0, left: -4 }} barCategoryGap="28%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} tickMargin={9} minTickGap={days > 30 ? 26 : 6} />
                <YAxis {...axisProps} tickFormatter={moneyTick} width={58} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(201, 118, 26, 0.05)" }} />
                {MODES.map((mode) => (
                  <Bar
                    key={mode}
                    dataKey={mode.toLowerCase()}
                    name={PAYMENT_MODE[mode].label}
                    stackId="collected"
                    fill={PAYMENT_MODE[mode].color}
                    maxBarSize={42}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="payment-rhythm">
            <div>
              <span>Best day</span>
              <strong>{inr(Math.max(...payments.data.daily.map((row) => Number(row.collected))))}</strong>
              <small>
                {formatDate(
                  payments.data.daily.reduce((best, row) =>
                    Number(row.collected) > Number(best.collected) ? row : best
                  ).day,
                  "short"
                )}
              </small>
            </div>
            <div>
              <span>Daily average</span>
              <strong>{inr(totalCollected / Math.max(payments.data.daily.length, 1))}</strong>
              <small>across {payments.data.daily.length} service days</small>
            </div>
            <div>
              <span>Digital share</span>
              <strong>{pct(digitalShare)}</strong>
              <small>card, UPI and online combined</small>
            </div>
          </div>
        </Card>

        <Card className="collection-card">
          <CardHeader title="Collection quality" subtitle="How settlement tracks recognised revenue" icon={Gauge} />
          <div className="collection-score">
            <div>
              <span className="collection-score__value">{pct(summary.collection_efficiency_pct)}</span>
              <span className="collection-score__label">of billed value collected</span>
            </div>
            <span className={Number(summary.collection_efficiency_pct) >= 99 ? "recon-seal is-ok" : "recon-seal is-bad"}>
              {Number(summary.collection_efficiency_pct) >= 99 ? <BadgeCheck size={18} /> : <IndianRupee size={18} />}
              <div>
                <strong>{Number(summary.collection_efficiency_pct) >= 99 ? "Healthy" : "Watch"}</strong>
                <span>{num(summary.payments)} settlements</span>
              </div>
            </span>
          </div>
          <div className="collection-bar">
            <span style={{ width: `${efficiency}%` }} />
            <i style={{ left: `${Math.min(efficiency, 100)}%` }} />
          </div>
          <div className="collection-scale">
            <span>₹0</span>
            <span>{inr(summary.billed_revenue)} billed</span>
          </div>
          <div className="collection-facts">
            <div>
              <span>Billed revenue</span>
              <strong>{inr(summary.billed_revenue)}</strong>
            </div>
            <div>
              <span>Collected</span>
              <strong>{inr(summary.collected)}</strong>
            </div>
            <div>
              <span>Largest payment</span>
              <strong>{inr(summary.largest_payment)}</strong>
            </div>
            <div>
              <span>Average ticket</span>
              <strong>{inr(summary.avg_payment)}</strong>
            </div>
          </div>
          <AnalyticsNote icon={Gauge}>
            Slightly above 100% is expected: a payment can settle a bill recognised just before the window opened.
            Collection and revenue are deliberately separate measures.
          </AnalyticsNote>
        </Card>
      </div>

      <div className="analytics-two-col analytics-two-col--modes">
        <Card>
          <CardHeader title="Payment mix" subtitle={`${days} days by value`} icon={CreditCard} />
          <div className="mix-layout">
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={mix}
                    dataKey="amount"
                    nameKey="payment_mode"
                    innerRadius={64}
                    outerRadius={92}
                    paddingAngle={2}
                    strokeWidth={2}
                    stroke="#fffdf8"
                  >
                    {mix.map((row) => (
                      <Cell key={row.payment_mode} fill={PAYMENT_MODE[row.payment_mode]?.color || CHART.toffee} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={
                      <ChartTip
                        valueFormatter={(value, entry) =>
                          `${inr(value)} · ${pct(entry.payload.payment_share_pct)}`
                        }
                      />
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <span>Collected</span>
                <strong>{inr(totalCollected)}</strong>
              </div>
            </div>
            <div className="legend-list">
              {mix.map((row) => (
                <div className="legend-list__row" key={row.payment_mode}>
                  <span
                    className="legend-list__dot"
                    style={{ background: PAYMENT_MODE[row.payment_mode]?.color || CHART.toffee }}
                  />
                  <div>
                    <strong>{PAYMENT_MODE[row.payment_mode]?.label || row.payment_mode}</strong>
                    <span>{num(row.payments)} payments</span>
                  </div>
                  <div className="legend-list__value">
                    <strong>{inr(row.amount)}</strong>
                    <span>{pct(row.payment_share_pct)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Mode economics"
            subtitle="How guests prefer to settle"
            icon={Wallet}
            actions={<Badge tone="teal">{pct(digitalShare)} digital</Badge>}
          />
          <div className="table-wrap">
            <table className="data-table mode-table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th className="num">Payments</th>
                  <th className="num">Collected</th>
                  <th className="num">Average</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {mix.map((row) => (
                  <tr key={row.payment_mode}>
                    <td>
                      <span className="mode-table__name">
                        <span
                          className="legend-list__dot"
                          style={{ background: PAYMENT_MODE[row.payment_mode]?.color || CHART.toffee }}
                        />
                        {PAYMENT_MODE[row.payment_mode]?.label || row.payment_mode}
                      </span>
                    </td>
                    <td className="num">{num(row.payments)}</td>
                    <td className="num strong">{inr(row.amount)}</td>
                    <td className="num">{inr(row.avg_payment)}</td>
                    <td>
                      <div className="mode-share">
                        <span>
                          <i style={{ width: `${row.payment_share_pct}%` }} />
                        </span>
                        <small>{pct(row.payment_share_pct)}</small>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mode-foot">
            <span>
              Peak collection day: <strong>{inr(largest)}</strong>
            </span>
            <span className="muted">Read from payments_hourly + raw events</span>
          </div>
        </Card>
      </div>

      <AnalyticsNote>
        Daily stacked bars are built from <code>payments_hourly</code>; the mix and efficiencies above use the raw
        event stream so split payments are counted exactly once.
      </AnalyticsNote>
    </>
  );
}
