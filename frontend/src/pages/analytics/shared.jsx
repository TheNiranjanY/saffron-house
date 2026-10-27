import { Database, Sparkles } from "lucide-react";
import { Card, Loading } from "../../components/UI";
import { cx } from "../../lib/utils";

export function AnalyticsLoading({ label = "Querying TimescaleDB" }) {
  return (
    <>
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((item) => (
          <Card className="stat" key={item}>
            <Loading label={item === 0 ? label : "Loading"} rows={3} />
          </Card>
        ))}
      </div>
      <div className="analytics-two-col">
        <Card><Loading label="Building charts" rows={7} /></Card>
        <Card><Loading label="Aggregating" rows={7} /></Card>
      </div>
    </>
  );
}

export function AnalyticsNote({ children, icon: Icon = Database, className }) {
  return (
    <div className={cx("analytics-note", className)}>
      <Icon size={13} />
      <span>{children}</span>
    </div>
  );
}

export function AnalyticsBanner({ title, children, tag = "TimescaleDB" }) {
  return (
    <Card className="analytics-banner">
      <span className="analytics-banner__icon">
        <Sparkles size={17} />
      </span>
      <div>
        <div className="analytics-banner__title">
          {title}
          <span className="analytics-banner__tag">{tag}</span>
        </div>
        <p>{children}</p>
      </div>
    </Card>
  );
}
