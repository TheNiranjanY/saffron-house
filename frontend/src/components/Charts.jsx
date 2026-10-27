import { CHART } from "../lib/constants";
import { inr, inrCompact, num } from "../lib/format";
import { cx } from "../lib/utils";

const MONEY_KEY = /revenue|amount|collected|grand|subtotal|cash|card|upi|online|sales|line_revenue|avg_bill|largest/i;

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: CHART.axis, fontSize: 11, fontFamily: "Inter, sans-serif" },
  stroke: CHART.grid,
};

export const gridProps = {
  stroke: CHART.grid,
  strokeDasharray: "3 6",
  vertical: false,
};

export function moneyTick(value) {
  return inrCompact(value);
}

export function ChartTip({ active, payload, label, labelFormatter, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <p className="chart-tip__label">{labelFormatter ? labelFormatter(label, payload) : label}</p>
      <div className="chart-tip__rows">
        {payload.map((entry, index) => {
          const key = `${entry.dataKey || entry.name}-${index}`;
          const money = MONEY_KEY.test(String(entry.dataKey || entry.name || ""));
          const value = valueFormatter
            ? valueFormatter(entry.value, entry)
            : money
              ? inr(entry.value, Number(entry.value) % 1 === 0 ? 0 : 2)
              : num(entry.value);
          return (
            <div className="chart-tip__row" key={key}>
              <span className="chart-tip__dot" style={{ background: entry.color || entry.fill || CHART.saffron }} />
              <span className="chart-tip__name">{entry.name}</span>
              <span className="chart-tip__value">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChartLegend({ items, className }) {
  return (
    <div className={cx("chart-legend", className)}>
      {items.map((item) => (
        <span className="chart-legend__item" key={item.label}>
          <span className="chart-legend__swatch" style={{ background: item.color, borderRadius: item.round ? "50%" : "3px" }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartEmpty({ message = "No data in this window.", height = 240 }) {
  return (
    <div className="chart-empty" style={{ height }}>
      <span className="chart-empty__mark" />
      <p>{message}</p>
    </div>
  );
}

export function ChartSkeleton({ height = 240 }) {
  return (
    <div className="chart-skeleton" style={{ height }} aria-busy="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
