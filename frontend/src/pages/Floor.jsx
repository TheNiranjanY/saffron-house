import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Armchair,
  ArrowRight,
  Clock3,
  IndianRupee,
  Plus,
  Receipt,
  RefreshCw,
  Users,
  Wallet,
} from "lucide-react";
import { useFetch } from "../lib/api";
import { ORDER_TYPE } from "../lib/constants";
import { elapsedSince, formatTime, inr, num } from "../lib/format";
import { cx } from "../lib/utils";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  PageHeader,
  PaymentBadge,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from "../components/UI";

const FILTERS = [
  { value: "all", label: "All tables" },
  { value: "free", label: "Free" },
  { value: "occupied", label: "Occupied" },
  { value: "settle", label: "To settle" },
];

function tableTone(table) {
  if (table.status === "FREE") return "free";
  if (table.payment_status === "PARTIAL") return "settle";
  if (table.order_status === "BILLED") return "billed";
  if (table.order_status === "PREPARED") return "settle";
  if (table.order_status === "PREPARING") return "preparing";
  return "placed";
}

export default function Floor() {
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useFetch("/tables", { poll: 15000 });
  const waiters = useFetch("/staff?role=WAITER&active=1");
  const customers = useFetch("/customers?limit=100");
  const [filter, setFilter] = useState("all");
  const [seatTable, setSeatTable] = useState(null);
  const [waiterId, setWaiterId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [notes, setNotes] = useState("");

  const tables = data?.tables || [];
  const stats = useMemo(() => {
    const occupied = tables.filter((table) => table.status === "OCCUPIED");
    const settle = occupied.filter(
      (table) => table.order_status === "PREPARED" || table.order_status === "BILLED" || table.payment_status === "PARTIAL"
    );
    return {
      free: tables.filter((table) => table.status === "FREE").length,
      occupied: occupied.length,
      settle: settle.length,
      covers: occupied.reduce((total, table) => total + (table.capacity || 0), 0),
      value: occupied.reduce((total, table) => total + Number(table.grand_total || table.order_total || 0), 0),
    };
  }, [tables]);

  useEffect(() => {
    if (seatTable && !waiterId && waiters.data?.staff?.length) {
      setWaiterId(String(waiters.data.staff[0].staff_id));
    }
  }, [seatTable, waiterId, waiters.data]);

  const visible = tables.filter((table) => {
    if (filter === "all") return true;
    if (filter === "free") return table.status === "FREE";
    if (filter === "occupied") return table.status === "OCCUPIED";
    return tableTone(table) === "settle";
  });

  function openSeatModal(table) {
    setSeatTable(table);
    setCustomerId("");
    setNotes("");
    setWaiterId(waiters.data?.staff?.[0] ? String(waiters.data.staff[0].staff_id) : "");
  }

  function startOrder() {
    if (!seatTable || !waiterId) return;
    const params = new URLSearchParams({ table: String(seatTable.table_id), waiter: waiterId });
    if (customerId) params.set("customer", customerId);
    if (notes.trim()) params.set("notes", notes.trim());
    navigate(`/pos?${params.toString()}`);
  }

  function openTable(table) {
    if (table.status === "FREE") {
      openSeatModal(table);
      return;
    }
    if (table.order_status === "BILLED" && table.bill_id) navigate(`/bills/${table.bill_id}`);
    else if (table.current_order_id) navigate(`/orders/${table.current_order_id}`);
  }

  return (
    <div className="page floor">
      <PageHeader
        eyebrow="Front of house"
        title="The room, at a glance."
        description="Seat arriving guests, watch preparation and move tables toward settlement. The floor refreshes itself every 15 seconds."
        actions={
          <>
            <button type="button" className="icon-btn" onClick={refresh} title="Refresh floor">
              <RefreshCw size={15} className={loading && data ? "spin" : ""} />
            </button>
            <Link to="/pos" className="btn btn--primary">
              <Plus size={15} />
              <span>Start an order</span>
            </Link>
          </>
        }
      />

      {!data && error ? (
        <ErrorState error={error} onRetry={refresh} title="The floor plan did not load" />
      ) : !data ? (
        <Card><Loading label="Reading table status" rows={4} /></Card>
      ) : (
        <>
          <div className="floor-summary">
            <Card className="floor-summary__item">
              <span className="floor-summary__icon tone-green"><Armchair size={17} /></span>
              <div><strong>{stats.free}</strong><span>tables free</span></div>
              <small>of {tables.length}</small>
            </Card>
            <Card className="floor-summary__item">
              <span className="floor-summary__icon tone-saffron"><Users size={17} /></span>
              <div><strong>{stats.occupied}</strong><span>tables seated</span></div>
              <small>{stats.covers} covers</small>
            </Card>
            <Card className="floor-summary__item">
              <span className="floor-summary__icon tone-violet"><Receipt size={17} /></span>
              <div><strong>{stats.settle}</strong><span>ready to settle</span></div>
              <small>prepared or billed</small>
            </Card>
            <Card className="floor-summary__item">
              <span className="floor-summary__icon tone-amber"><IndianRupee size={17} /></span>
              <div><strong>{inr(stats.value, 0)}</strong><span>on open tables</span></div>
              <small>orders in progress</small>
            </Card>
          </div>

          <div className="floor-toolbar">
            <Tabs
              tabs={FILTERS.map((item) => ({
                ...item,
                count:
                  item.value === "all"
                    ? tables.length
                    : item.value === "free"
                      ? stats.free
                      : item.value === "occupied"
                        ? stats.occupied
                        : stats.settle,
              }))}
              value={filter}
              onChange={setFilter}
            />
            <span className="floor-toolbar__hint">
              <span className="pulse-dot is-live" /> Auto-refreshing · {formatTime(new Date().toISOString())}
            </span>
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={Armchair}
                title="No tables in this view"
                description="Try another filter, or open the full floor."
                action={<Button variant="outline" onClick={() => setFilter("all")}>Show all tables</Button>}
              />
            </Card>
          ) : (
            <div className="table-grid">
              {visible.map((table) => {
                const tone = tableTone(table);
                const total = table.grand_total ?? table.order_total;
                return (
                  <article
                    key={table.table_id}
                    className={cx("table-tile", `table-tile--${tone}`)}
                    onClick={() => openTable(table)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openTable(table);
                      }
                    }}
                  >
                    <div className="table-tile__top">
                      <span className="table-tile__number">{String(table.table_id).padStart(2, "0")}</span>
                      <div className="table-tile__badges">
                        <span className="capacity"><Users size={11} /> {table.capacity}</span>
                        {table.status === "FREE" ? <Badge tone="green" dot>Free</Badge> : <StatusBadge value={table.order_status} />}
                      </div>
                    </div>

                    {table.status === "FREE" ? (
                      <div className="table-tile__empty">
                        <span className="table-tile__plus"><Plus size={18} /></span>
                        <p>Tap to seat</p>
                        <small>Start a tab on this table</small>
                      </div>
                    ) : (
                      <>
                        <div className="table-tile__order">
                          <Link
                            to={table.order_status === "BILLED" && table.bill_id ? `/bills/${table.bill_id}` : `/orders/${table.current_order_id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="table-tile__orderid"
                          >
                            #{table.current_order_id}
                          </Link>
                          <span>{table.waiter_name || "Unassigned"}</span>
                        </div>
                        <div className="table-tile__meta">
                          <span><Clock3 size={12} /> {elapsedSince(table.placed_at)}</span>
                          <span>{table.item_count} {table.item_count === 1 ? "line" : "lines"}</span>
                        </div>
                        <div className="table-tile__foot">
                          <div>
                            <span>{table.order_status === "BILLED" ? "Bill total" : "Running total"}</span>
                            <strong>{inr(total)}</strong>
                          </div>
                          {table.bill_id ? (
                            <span className="table-tile__bill">
                              <Wallet size={12} /> #{table.bill_id}
                              <PaymentBadge value={table.payment_status} />
                            </span>
                          ) : (
                            <Badge tone={ORDER_TYPE[table.order_type]?.tone || "neutral"}>
                              {ORDER_TYPE[table.order_type]?.label || table.order_type}
                            </Badge>
                          )}
                        </div>
                        {tone === "settle" ? (
                          <Link
                            to={table.bill_id ? `/bills/${table.bill_id}` : `/orders/${table.current_order_id}`}
                            className="table-tile__cta"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {table.bill_id ? "Settle bill" : "Review ticket"} <ArrowRight size={13} />
                          </Link>
                        ) : null}
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <div className="floor-legend">
            <span><i className="legend-swatch legend-swatch--placed" /> Placed</span>
            <span><i className="legend-swatch legend-swatch--preparing" /> Preparing</span>
            <span><i className="legend-swatch legend-swatch--settle" /> Ready to settle</span>
            <span><i className="legend-swatch legend-swatch--free" /> Free</span>
          </div>
        </>
      )}

      <Modal
        open={Boolean(seatTable)}
        onClose={() => setSeatTable(null)}
        title={seatTable ? `Seat table ${String(seatTable.table_id).padStart(2, "0")}` : ""}
        description={seatTable ? `A ${seatTable.capacity}-seat table. Choose who is serving and take the order.` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSeatTable(null)}>Cancel</Button>
            <Button variant="primary" icon={ArrowRight} onClick={startOrder} disabled={!waiterId}>
              Open ticket
            </Button>
          </>
        }
      >
        <div className="form-stack">
          <Field label="Serving waiter" htmlFor="seat-waiter">
            <Select id="seat-waiter" value={waiterId} onChange={(event) => setWaiterId(event.target.value)}>
              <option value="">Select a waiter</option>
              {(waiters.data?.staff || []).map((person) => (
                <option key={person.staff_id} value={person.staff_id}>
                  {person.name}{person.table_section ? ` · ${person.table_section}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Known guest" htmlFor="seat-guest" hint="Optional. Walk-in guests can be left blank.">
            <Select id="seat-guest" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Walk-in guest</option>
              {(customers.data?.customers || []).map((customer) => (
                <option key={customer.customer_id} value={customer.customer_id}>
                  {customer.name}{customer.phone ? ` · ${customer.phone}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service note" htmlFor="seat-notes" hint="Allergies, celebrations or seating requests.">
            <Textarea
              id="seat-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. Birthday celebration, bring a candle with dessert"
              maxLength={255}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
