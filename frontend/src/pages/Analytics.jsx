import { useSearchParams } from "react-router-dom";
import {
  ChefHat,
  Database,
  LineChart,
  Terminal,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { LinkButton, PageHeader, Segmented, Tabs } from "../components/UI";
import { AnalyticsBanner } from "./analytics/shared";
import AnalyticsRevenue from "./analytics/AnalyticsRevenue";
import AnalyticsMenu from "./analytics/AnalyticsMenu";
import AnalyticsKitchen from "./analytics/AnalyticsKitchen";
import AnalyticsPayments from "./analytics/AnalyticsPayments";
import AnalyticsSystem from "./analytics/AnalyticsSystem";

const TABS = [
  { value: "revenue", label: "Revenue", icon: LineChart },
  { value: "menu", label: "Menu & flow", icon: UtensilsCrossed },
  { value: "kitchen", label: "Kitchen", icon: ChefHat },
  { value: "payments", label: "Payments", icon: Wallet },
  { value: "system", label: "Data platform", icon: Database },
];

const TAB_VALUES = new Set(TABS.map((tab) => tab.value));
const DAY_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];
const DAY_VALUES = new Set(DAY_OPTIONS.map((option) => option.value));

const VIEWS = {
  revenue: AnalyticsRevenue,
  menu: AnalyticsMenu,
  kitchen: AnalyticsKitchen,
  payments: AnalyticsPayments,
  system: AnalyticsSystem,
};

export default function Analytics() {
  const [params, setParams] = useSearchParams();
  const tab = TAB_VALUES.has(params.get("tab")) ? params.get("tab") : "revenue";
  const requestedDays = Number(params.get("days"));
  const days = DAY_VALUES.has(requestedDays) ? requestedDays : 30;

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    next.set(key, String(value));
    setParams(next, { replace: true });
  };

  const View = VIEWS[tab];
  const currentTab = TABS.find((entry) => entry.value === tab);

  return (
    <>
      <PageHeader
        eyebrow="Insight workspace"
        title="The room, measured."
        description="An operational ledger in MySQL, mirrored as a time-series event stream in TimescaleDB. Every chart below can be traced back to both."
        actions={
          <>
            <Segmented options={DAY_OPTIONS} value={days} onChange={(value) => update("days", value)} />
            <LinkButton to="/sql" variant="dark" icon={Terminal}>
              SQL Lab
            </LinkButton>
          </>
        }
      />

      <AnalyticsBanner title={`${currentTab.label} · ${days}-day window`} tag="Live read model">
        Revenue is recognised when a bill is generated. Money is collected when payments arrive. All daily buckets
        are aligned to Asia/Kolkata, not UTC.
      </AnalyticsBanner>

      <div className="analytics-toolbar">
        <Tabs tabs={TABS} value={tab} onChange={(value) => update("tab", value)} />
        <span className="analytics-toolbar__note">
          <span className="pulse-dot is-live" />
          TimescaleDB · real-time aggregation
        </span>
      </div>

      <div className="analytics-body" key={`${tab}-${days}`}>
        <View days={days} />
      </div>
    </>
  );
}
