import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronRight, Filter, Plus, RefreshCw, ReceiptText } from "lucide-react";
import { useFetch } from "../lib/api";
import { ORDER_STATUS, ORDER_TYPE } from "../lib/constants";
import { formatTime, inr, num } from "../lib/format";
import { cx } from "../lib/utils";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Pagination,
  PaymentBadge,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
} from "../components/UI";

const SCOPES = [
  { value: "active", label: "Active" },
  { value: "today", label: "Today" },
  { value: "all", label: "All orders" },
];

const STATUS_OPTIONS = Object.entries(ORDER_STATUS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const TYPE_OPTIONS = Object.entries(ORDER_TYPE).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const PAGE_SIZE = 25;

export default function Orders() {
  const navigate = useNavigate();
  const [scope, setScope] = useState("active");
  const [status, setStatus] = useState("");
  const [orderType, setOrderType] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      scope,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (status) params.set("status", status);
    if (orderType) params.set("order_type", orderType);
    if (term) params.set("q", term);
    return params.toString();
  }, [scope, status, orderType, term, offset]);

  const { data, error, loading, refresh } = useFetch(`/orders?${query}`, { poll: 20000 });

  function switchScope(next) {
    setScope(next);
    setOffset(0);
  }

  const activeSummary = data?.active_summary;
  const hasFilters = Boolean(status || orderType || term);

  return (
    <div className="page orders">
      <PageHeader
        eyebrow="Service ledger"
        title="Every ticket, accounted for."
        description="Follow an order from the pass to the payment counter. Active tickets update automatically; closed ones remain auditable."
        actions={
          <>
            <button type="button" className="icon-btn" onClick={refresh} title="Refresh orders">
              <RefreshCw size={15} className={loading && data ? "spin" : ""} />
            </button>
            <Link to="/pos" className="btn btn--primary">
              <Plus size={15} />
              <span>New order</span>
            </Link>
          </>
        }
      />

      {activeSummary && scope === "active" ? (
        <div className="pipeline-strip">
          {Object.entries(activeSummary).map(([key, value], index) => (
            <div className="pipeline-strip__item" key={key}>
              <span className="pipeline-strip__step">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <StatusBadge value={key} />
                <strong>{value}</strong>
              </div>
            </div>
          ))}
          <div className="pipeline-strip__note">
            <span className="pulse-dot is-live" />
            {num(data.total)} active {data.total === 1 ? "ticket" : "tickets"} in the pipeline
          </div>
        </div>
      ) : null}

      <Card className="table-card orders-card">
        <div className="orders-toolbar">
          <Tabs tabs={SCOPES} value={scope} onChange={switchScope} />
          <div className="orders-toolbar__filters">
            <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order #, guest or waiter" />
            <Select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
            <Select
              value={orderType}
              onChange={(event) => {
                setOrderType(event.target.value);
                setOffset(0);
              }}
              aria-label="Filter by order type"
            >
              <option value="">All types</option>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatus("");
                  setOrderType("");
                  setSearch("");
                  setOffset(0);
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {error && !data ? (
          <div className="table-empty">
            <ErrorState error={error} onRetry={refresh} title="Orders could not be loaded" />
          </div>
        ) : !data ? (
          <div className="table-empty"><Loading label="Looking up tickets" rows={4} /></div>
        ) : data.orders.length === 0 ? (
          <div className="table-empty">
            <EmptyState
              icon={ReceiptText}
              title={hasFilters ? "No orders match these filters" : "No orders in this view"}
              description={
                hasFilters
                  ? "Try another status, type or search term."
                  : scope === "active"
                    ? "Everything is settled. Start a new order when the next guest arrives."
                    : "Orders will appear here as soon as service begins."
              }
              action={
                hasFilters ? (
                  <Button variant="outline" icon={Filter} onClick={() => { setStatus(""); setOrderType(""); setSearch(""); }}>
                    Reset filters
                  </Button>
                ) : (
                  <Link to="/pos" className="btn btn--primary"><Plus size={15} /> New order</Link>
                )
              }
            />
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table orders-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Type / table</th>
                    <th>Waiter</th>
                    <th className="num">Items</th>
                    <th>Status</th>
                    <th>Bill</th>
                    <th className="num">Total</th>
                    <th>Placed</th>
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((order) => (
                    <tr
                      key={order.order_id}
                      className="is-clickable"
                      onClick={() => navigate(`/orders/${order.order_id}`)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") navigate(`/orders/${order.order_id}`);
                      }}
                    >
                      <td>
                        <Link
                          to={`/orders/${order.order_id}`}
                          className="strong"
                          onClick={(event) => event.stopPropagation()}
                        >
                          #{order.order_id}
                        </Link>
                        <span className="sub truncate">{order.notes || (order.customer_name ? order.customer_name : "No note")}</span>
                      </td>
                      <td>
                        <Badge tone={ORDER_TYPE[order.order_type]?.tone || "neutral"}>
                          {ORDER_TYPE[order.order_type]?.label || order.order_type}
                        </Badge>
                        <span className="sub">{order.table_id ? `Table ${order.table_id}` : "Counter"}</span>
                      </td>
                      <td>
                        {order.waiter_name}
                        {order.customer_name ? <span className="sub">{order.customer_name}</span> : null}
                      </td>
                      <td className="num">{order.item_count}</td>
                      <td><StatusBadge value={order.status} /></td>
                      <td>
                        {order.bill_id ? (
                          <div className="bill-cell">
                            <span className="strong">#{order.bill_id}</span>
                            <PaymentBadge value={order.payment_status} />
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="num strong">{inr(order.grand_total ?? order.items_subtotal)}</td>
                      <td className="nowrap muted">{formatTime(order.placed_at)}</td>
                      <td className="actions">
                        <ChevronRight size={15} className="row-chevron" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />
          </>
        )}
      </Card>

      <div className="orders-note">
        <span><span className={cx("pulse-dot", "is-live")} /> 20s auto-refresh</span>
        <span>Revenue is counted at bill generation, not order placement.</span>
        <Link to="/analytics" className="link">See the analytical view <ArrowRight size={13} /></Link>
      </div>
    </div>
  );
}
