import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  IndianRupee,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useFetch } from "../lib/api";
import { ORDER_TYPE } from "../lib/constants";
import { dateInputDaysAgo, dateInputValue, formatDate, formatTime, fromNow, inr, num } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Loading,
  PageHeader,
  Pagination,
  PaymentBadge,
  SearchInput,
  Segmented,
  Select,
  StatCard,
  Tabs,
} from "../components/UI";

const LEDGER_PAGE = 40;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIAL", label: "Part paid" },
  { value: "PAID", label: "Paid" },
];

const OUTSTANDING_FILTERS = [
  { value: "all", label: "All" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIAL", label: "Part paid" },
];

export default function Billing() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("outstanding");
  const [outstandingFilter, setOutstandingFilter] = useState("all");
  const [outstandingSearch, setOutstandingSearch] = useState("");
  const [fromDate, setFromDate] = useState(dateInputDaysAgo(6));
  const [toDate, setToDate] = useState(dateInputValue());
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const outstanding = useFetch("/bills/outstanding?limit=200", { poll: 20000 });
  const ledgerPath = useMemo(() => {
    const params = new URLSearchParams({ from_date: fromDate, to_date: toDate, limit: String(LEDGER_PAGE), offset: String(offset) });
    if (status) params.set("status", status);
    return `/bills?${params.toString()}`;
  }, [fromDate, toDate, status, offset]);
  const ledger = useFetch(ledgerPath, { enabled: tab === "ledger" });

  const outstandingRows = useMemo(() => {
    const term = outstandingSearch.trim().toLowerCase();
    return (outstanding.data?.bills || []).filter((bill) => {
      if (outstandingFilter !== "all" && bill.payment_status !== outstandingFilter) return false;
      if (!term) return true;
      return (
        String(bill.bill_id).includes(term) ||
        String(bill.order_id).includes(term) ||
        bill.waiter_name?.toLowerCase().includes(term) ||
        bill.customer_name?.toLowerCase().includes(term) ||
        String(bill.table_id || "").includes(term)
      );
    });
  }, [outstanding.data, outstandingFilter, outstandingSearch]);

  const summary = tab === "outstanding" ? outstanding.data?.summary : ledger.data?.summary;
  const loading = tab === "outstanding" ? outstanding.loading && !outstanding.data : ledger.loading && !ledger.data;
  const error = tab === "outstanding" ? outstanding.error && !outstanding.data : ledger.error && !ledger.data;

  function refresh() {
    if (tab === "outstanding") outstanding.refresh();
    else ledger.refresh();
  }

  function setPreset(days) {
    setFromDate(dateInputDaysAgo(days - 1));
    setToDate(dateInputValue());
    setOffset(0);
  }

  const toSettle = outstanding.data?.bills?.length || 0;
  const outstandingValue = outstanding.data?.summary?.outstanding || 0;

  return (
    <div className="page billing">
      <PageHeader
        eyebrow="Payment counter"
        title="Bills, settled and open."
        description="Collect against generated bills, split a payment across modes, and watch the table release itself when the balance reaches zero."
        actions={
          <>
            <button type="button" className="icon-btn" onClick={refresh} title="Refresh bills">
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
            <Link to="/pos" className="btn btn--primary">
              <Receipt size={15} />
              <span>New order</span>
            </Link>
          </>
        }
      />

      {toSettle > 0 ? (
        <div className="billing-alert">
          <span className="billing-alert__icon"><Wallet size={17} /></span>
          <div className="grow">
            <strong>{toSettle} {toSettle === 1 ? "bill is" : "bills are"} awaiting settlement</strong>
            <span>{inr(outstandingValue, 2)} outstanding across the room. Tables stay occupied until paid in full.</span>
          </div>
          <button type="button" className="btn btn--dark btn--sm" onClick={() => setTab("outstanding")}>
            Collect now <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <div className="billing-alert billing-alert--clear">
          <span className="billing-alert__icon"><CircleDollarSign size={17} /></span>
          <div className="grow">
            <strong>The counter is clear</strong>
            <span>Every generated bill has been paid in full.</span>
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <StatCard
          label={tab === "outstanding" ? "Outstanding bills" : "Bills in window"}
          value={num(summary?.bills || 0)}
          icon={Receipt}
          tone="saffron"
          sub={tab === "outstanding" ? "open across service" : `${formatDate(fromDate, "short")} → ${formatDate(toDate, "short")}`}
        />
        <StatCard
          label="Revenue billed"
          value={inr(summary?.revenue || 0)}
          icon={IndianRupee}
          tone="violet"
          sub="recognised at bill generation"
        />
        <StatCard
          label="Collected"
          value={inr(summary?.collected || 0)}
          icon={Banknote}
          tone="green"
          sub={`${summary?.revenue ? Math.round((Number(summary.collected) / Number(summary.revenue)) * 100) : 0}% of billed revenue`}
        />
        <StatCard
          label="Still outstanding"
          value={inr(summary?.outstanding || 0)}
          icon={Wallet}
          tone="red"
          sub={tab === "outstanding" ? "across unpaid bills" : "unsettled in this window"}
        />
      </div>

      <Card className="table-card">
        <div className="billing-toolbar">
          <Tabs
            tabs={[
              { value: "outstanding", label: "Outstanding", count: toSettle },
              { value: "ledger", label: "Bill ledger" },
            ]}
            value={tab}
            onChange={(value) => {
              setTab(value);
              setOffset(0);
            }}
          />
          {tab === "outstanding" ? (
            <div className="billing-toolbar__filters">
              <SearchInput
                value={outstandingSearch}
                onChange={(event) => setOutstandingSearch(event.target.value)}
                placeholder="Bill, order, table or guest"
              />
              <Segmented options={OUTSTANDING_FILTERS} value={outstandingFilter} onChange={setOutstandingFilter} size="sm" />
            </div>
          ) : (
            <div className="billing-toolbar__filters billing-dates">
              <Segmented
                options={[
                  { value: 1, label: "Today" },
                  { value: 7, label: "7 days" },
                  { value: 30, label: "30 days" },
                ]}
                value={[1, 7, 30].find((days) => fromDate === dateInputDaysAgo(days - 1) && toDate === dateInputValue()) || 0}
                onChange={setPreset}
                size="sm"
              />
              <div className="date-range">
                <CalendarDays size={14} />
                <Input
                  type="date"
                  value={fromDate}
                  max={toDate}
                  onChange={(event) => {
                    setFromDate(event.target.value);
                    setOffset(0);
                  }}
                  aria-label="From date"
                />
                <span>→</span>
                <Input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  max={dateInputValue()}
                  onChange={(event) => {
                    setToDate(event.target.value);
                    setOffset(0);
                  }}
                  aria-label="To date"
                />
              </div>
              <Select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setOffset(0);
                }}
                aria-label="Payment status"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {error ? (
          <div className="table-empty">
            <ErrorState
              error={tab === "outstanding" ? outstanding.error : ledger.error}
              onRetry={refresh}
              title="Bills could not be loaded"
            />
          </div>
        ) : loading ? (
          <div className="table-empty"><Loading label="Reconciling bills and payments" rows={4} /></div>
        ) : tab === "outstanding" ? (
          outstandingRows.length === 0 ? (
            <div className="table-empty">
              <EmptyState
                icon={CircleDollarSign}
                title={outstandingSearch || outstandingFilter !== "all" ? "No bills match this view" : "Every bill is settled"}
                description={
                  outstandingSearch || outstandingFilter !== "all"
                    ? "Clear the search or choose another payment state."
                    : "Newly generated bills will appear here until the balance reaches zero."
                }
                action={
                  outstandingSearch || outstandingFilter !== "all" ? (
                    <Button variant="outline" onClick={() => { setOutstandingSearch(""); setOutstandingFilter("all"); }}>Clear filters</Button>
                  ) : (
                    <Link to="/floor" className="btn btn--outline">Back to floor</Link>
                  )
                }
              />
            </div>
          ) : (
            <BillTable rows={outstandingRows} onOpen={(id) => navigate(`/bills/${id}`)} outstanding />
          )
        ) : ledger.data?.bills?.length === 0 ? (
          <div className="table-empty">
            <EmptyState
              icon={Receipt}
              title="No bills in this window"
              description={`No bills were generated between ${formatDate(fromDate, "short")} and ${formatDate(toDate, "short")}. Try a wider date range.`}
              action={<Button variant="outline" onClick={() => setPreset(30)}>Show 30 days</Button>}
            />
          </div>
        ) : (
          <>
            <BillTable rows={ledger.data?.bills || []} onOpen={(id) => navigate(`/bills/${id}`)} />
            <Pagination total={ledger.data?.total || 0} limit={ledger.data?.limit || LEDGER_PAGE} offset={ledger.data?.offset || 0} onChange={setOffset} />
          </>
        )}
      </Card>

      <div className="billing-footnote">
        <CalendarDays size={13} />
        <span>Dates and bill timestamps use Asia/Kolkata. Outstanding means generated minus successful payments.</span>
        <Link to="/analytics?tab=payments" className="link">Payment analytics <ArrowRight size={12} /></Link>
      </div>
    </div>
  );
}

function BillTable({ rows, onOpen, outstanding = false }) {
  return (
    <div className="table-wrap">
      <table className="data-table billing-table">
        <thead>
          <tr>
            <th>Bill</th>
            <th>Order</th>
            <th>Table</th>
            <th>Guest / waiter</th>
            <th className="num">Total</th>
            <th className="num">Paid</th>
            <th className="num">Balance</th>
            <th>Status</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((bill) => (
            <tr
              key={bill.bill_id}
              className="is-clickable"
              onClick={() => onOpen(bill.bill_id)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter") onOpen(bill.bill_id);
              }}
            >
              <td>
                <span className="strong">#{bill.bill_id}</span>
                <span className="sub">{formatTime(bill.generated_at)}{outstanding ? ` · ${fromNow(bill.generated_at)}` : ""}</span>
              </td>
              <td>
                <span className="strong">#{bill.order_id}</span>
                <span className="sub">{bill.item_count} lines</span>
              </td>
              <td>
                {bill.table_id ? `Table ${bill.table_id}` : <Badge tone={ORDER_TYPE[bill.order_type]?.tone || "neutral"}>{ORDER_TYPE[bill.order_type]?.label || bill.order_type}</Badge>}
              </td>
              <td>
                {bill.customer_name || bill.waiter_name}
                <span className="sub">{bill.customer_name ? `Served by ${bill.waiter_name}` : "Walk-in guest"}</span>
              </td>
              <td className="num strong">{inr(bill.grand_total, 2)}</td>
              <td className="num">{inr(bill.paid_amount, 2)}</td>
              <td className={`num ${Number(bill.balance) > 0 ? "balance-due" : "muted"}`}>{inr(bill.balance, 2)}</td>
              <td><PaymentBadge value={bill.payment_status} /></td>
              <td className="actions"><ChevronRight size={15} className="row-chevron" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
