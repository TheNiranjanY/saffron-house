import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CheckCheck,
  ChefHat,
  Clock3,
  Minus,
  Plus,
  Play,
  ReceiptText,
  RefreshCw,
  Search,
  Sparkles,
  User,
  Utensils,
  Wallet,
} from "lucide-react";
import { api, useFetch } from "../lib/api";
import { ORDER_TYPE } from "../lib/constants";
import { elapsedSince, formatDateTime, formatDuration, formatTime, fromNow, inr } from "../lib/format";
import { cx } from "../lib/utils";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  Loading,
  Modal,
  PageHeader,
  PaymentBadge,
  Select,
  StatusBadge,
} from "../components/UI";

const TAX_RATE = 5;
const ADD_STATUS = ["PLACED", "PREPARING"];

const EVENT_TONE = {
  placed: "amber",
  added: "saffron",
  preparing: "blue",
  prepared: "green",
  billed: "violet",
  payment: "teal",
  closed: "neutral",
  cancelled: "red",
};

export default function OrderDetail() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, refresh } = useFetch(`/orders/${orderId}`, { poll: 15000 });
  const menu = useFetch("/menu?available=1");
  const chefs = useFetch("/staff?role=CHEF&active=1");

  const [acting, setActing] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [billForm, setBillForm] = useState({ discount_pct: "0", tax_rate: String(TAX_RATE) });
  const [itemsOpen, setItemsOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addChef, setAddChef] = useState("");
  const [addQty, setAddQty] = useState({});

  const order = data?.order;
  const items = data?.items || [];
  const bill = data?.bill;
  const status = order?.status;
  const canAdd = ADD_STATUS.includes(status) && !bill;
  const canCancel = ["PLACED", "PREPARING", "PREPARED"].includes(status);
  const chefList = chefs.data?.staff || [];

  useEffect(() => {
    if (addChef || !chefList.length) return;
    setAddChef(String(chefList[0].staff_id));
  }, [addChef, chefList]);

  const preview = useMemo(() => {
    const subtotal = Number(order?.items_subtotal || 0);
    const rate = Math.max(0, Math.min(100, Number(billForm.tax_rate) || 0)) / 100;
    const discountRate = Math.max(0, Math.min(100, Number(billForm.discount_pct) || 0)) / 100;
    const tax = Math.round(subtotal * rate * 100) / 100;
    const discount = Math.round(subtotal * discountRate * 100) / 100;
    return { subtotal, tax, discount, grand: subtotal + tax - discount };
  }, [order?.items_subtotal, billForm]);

  const addTotal = Object.entries(addQty).reduce((total, [itemId, quantity]) => {
    const item = menu.data?.items?.find((row) => row.item_id === Number(itemId));
    return total + (item ? Number(item.price) * quantity : 0);
  }, 0);
  const addCount = Object.values(addQty).reduce((total, quantity) => total + quantity, 0);

  const filteredMenu = (menu.data?.items || []).filter(
    (item) =>
      !addSearch.trim() ||
      item.name.toLowerCase().includes(addSearch.toLowerCase()) ||
      item.category_name.toLowerCase().includes(addSearch.toLowerCase())
  );

  function changeAdd(item, delta) {
    setAddQty((current) => {
      const next = Math.max(0, Math.min(50, (current[item.item_id] || 0) + delta));
      const copy = { ...current };
      if (next === 0) delete copy[item.item_id];
      else copy[item.item_id] = next;
      return copy;
    });
  }

  async function performStatus(target, label) {
    setActing(target);
    try {
      const response = await api.post(`/orders/${orderId}/status`, { status: target });
      toast.success(label, response?.sync?.projected ? `${response.sync.projected} analytics events projected.` : "MySQL and the event stream are in sync.");
      refresh();
    } catch (requestError) {
      toast.error("Status change failed", requestError.message);
    } finally {
      setActing("");
    }
  }

  async function cancelOrder() {
    setActing("CANCELLED");
    try {
      await api.post(`/orders/${orderId}/status`, { status: "CANCELLED" });
      toast.success(`Order #${orderId} cancelled`, "The table has been released.");
      setCancelOpen(false);
      refresh();
    } catch (requestError) {
      toast.error("Could not cancel the order", requestError.message);
    } finally {
      setActing("");
    }
  }

  async function generateBill() {
    setActing("BILL");
    try {
      const response = await api.post(`/orders/${orderId}/bill`, {
        discount_pct: Number(billForm.discount_pct) || 0,
        tax_rate: (Number(billForm.tax_rate) || 0) / 100,
      });
      const created = response.bill.bill;
      toast.success(`Bill #${created.bill_id} generated`, `${inr(created.grand_total, 2)} is now due.`);
      setBillOpen(false);
      navigate(`/bills/${created.bill_id}`);
    } catch (requestError) {
      toast.error("Could not generate the bill", requestError.message);
    } finally {
      setActing("");
    }
  }

  async function addItems() {
    if (!addCount) return;
    setActing("ITEMS");
    try {
      const response = await api.post(`/orders/${orderId}/items`, {
        items: Object.entries(addQty).map(([itemId, quantity]) => ({
          item_id: Number(itemId),
          chef_id: Number(addChef),
          quantity,
        })),
      });
      toast.success(`${addCount} item${addCount === 1 ? "" : "s"} added`, "The kitchen and the event stream both know.");
      setItemsOpen(false);
      setAddQty({});
      setAddSearch("");
      refresh();
    } catch (requestError) {
      toast.error("Could not add items", requestError.message);
    } finally {
      setActing("");
    }
  }

  if (!data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Order ticket" title={`Order #${orderId}`} description="Loading the ticket and its event history…" />
        {error ? (
          <ErrorState error={error} onRetry={refresh} title="This order could not be loaded" />
        ) : (
          <Card><Loading label="Reading order, items and timeline" rows={5} /></Card>
        )}
      </div>
    );
  }

  const finalTotal = bill ? Number(bill.grand_total) : preview.grand;
  const paid = bill ? Number(bill.paid_amount) : 0;
  const balance = bill ? Number(bill.balance) : 0;
  const isSettled = status === "CLOSED" || bill?.payment_status === "PAID";

  return (
    <div className="page order-detail">
      <div className="backline">
        <Link to="/orders" className="backlink">
          <ArrowLeft size={14} /> All orders
        </Link>
        <button type="button" className="icon-btn" onClick={refresh} title="Refresh order">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      <PageHeader
        eyebrow="Order ticket"
        title={
          <span className="title-with-badge">
            Order #{order.order_id}
            <StatusBadge value={order.status} />
          </span>
        }
        description={
          <span className="order-subline">
            <span>{ORDER_TYPE[order.order_type]?.label || order.order_type}</span>
            {order.table_id ? <span>Table {String(order.table_id).padStart(2, "0")} · {order.table_capacity} seats</span> : <span>Counter service</span>}
            <span>{order.waiter_name}</span>
            <span>{elapsedSince(order.placed_at)} old</span>
          </span>
        }
        actions={
          <>
            {canAdd ? (
              <Button variant="outline" icon={Plus} onClick={() => setItemsOpen(true)}>
                Add items
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="danger" icon={Ban} onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            ) : null}
            {status === "PLACED" ? (
              <Button icon={Play} loading={acting === "PREPARING"} onClick={() => performStatus("PREPARING", "Kitchen started")}>
                Start preparing
              </Button>
            ) : null}
            {status === "PREPARING" ? (
              <Button icon={CheckCheck} loading={acting === "PREPARED"} onClick={() => performStatus("PREPARED", "Order prepared")}>
                Mark prepared
              </Button>
            ) : null}
            {status === "PREPARED" && !bill ? (
              <Button icon={ReceiptText} onClick={() => setBillOpen(true)}>
                Generate bill
              </Button>
            ) : null}
            {bill ? (
              <LinkButton to={`/bills/${bill.bill_id}`} icon={Wallet} variant={isSettled ? "outline" : "primary"}>
                {isSettled ? "View receipt" : "Settle bill"}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="order-grid">
        <div className="order-column">
          <Card className="order-items-card">
            <CardHeader
              title="On the ticket"
              subtitle={`${items.length} lines · ${order.item_count} items`}
              icon={Utensils}
              actions={canAdd ? (
                <Button variant="ghost" size="sm" icon={Plus} onClick={() => setItemsOpen(true)}>Add dishes</Button>
              ) : null}
            />
            {items.length === 0 ? (
              <EmptyState icon={Utensils} title="No items" description="This order has no dishes attached." />
            ) : (
              <div className="order-items">
                {items.map((item) => (
                  <div className="order-item" key={`${item.line_no}-${item.item_id}`}>
                    <span className={cx("veg-mark", !item.is_veg && "veg-mark--nonveg")} />
                    <div className="order-item__body">
                      <div className="order-item__title">
                        <span>{item.item_name}</span>
                        <strong>{inr(item.line_total, 2)}</strong>
                      </div>
                      <div className="order-item__meta">
                        <span>{item.category_name}</span>
                        <span>Line {String(item.line_no).padStart(2, "0")}</span>
                        <span><ChefHat size={11} /> {item.chef_name}</span>
                      </div>
                    </div>
                    <div className="order-item__qty">
                      <span>{item.quantity} ×</span>
                      <small>{inr(item.price_at_order, 0)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {order.notes ? (
              <div className="order-note">
                <span className="order-note__label">Service note</span>
                <p>{order.notes}</p>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Order timeline" subtitle="Events projected into the analytics hypertable" icon={Clock3} />
            <ol className="timeline">
              {data.timeline.map((event, index) => (
                <li className={cx("timeline__item", index === data.timeline.length - 1 && "is-last")} key={`${event.type}-${index}`}>
                  <span className={cx("timeline__dot", `tone-${EVENT_TONE[event.type] || "neutral"}`)} />
                  <div className="timeline__body">
                    <div className="timeline__title">
                      <span>{event.title}</span>
                      <time title={formatDateTime(event.at)}>{formatTime(event.at)}</time>
                    </div>
                    {event.detail ? <p>{event.detail}</p> : null}
                    <small>{fromNow(event.at)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="order-side">
          <Card className={cx("order-summary", isSettled && "is-settled")}>
            <div className="order-summary__head">
              <div>
                <p className="eyebrow">{bill ? "Bill" : "Running total"}</p>
                <h2>{bill ? `#${bill.bill_id}` : "Not billed yet"}</h2>
              </div>
              {bill ? <PaymentBadge value={bill.payment_status} /> : <Badge tone="neutral">Pre-bill</Badge>}
            </div>

            <div className="kv order-summary__kv">
              <div className="kv__row"><span className="kv__label">Subtotal</span><span className="kv__value">{inr(bill ? bill.subtotal : preview.subtotal, 2)}</span></div>
              <div className="kv__row">
                <span className="kv__label">Tax {bill ? "" : "· est. 5%"}</span>
                <span className="kv__value">{inr(bill ? bill.tax : preview.tax, 2)}</span>
              </div>
              {Number(bill?.discount_amount || 0) > 0 ? (
                <div className="kv__row"><span className="kv__label">Discount</span><span className="kv__value">−{inr(bill.discount_amount, 2)}</span></div>
              ) : null}
              <div className="kv__row kv__row--total"><span className="kv__label">Total</span><span className="kv__value">{inr(finalTotal, 2)}</span></div>
              {bill ? (
                <>
                  <div className="kv__row"><span className="kv__label">Paid</span><span className="kv__value">{inr(paid, 2)}</span></div>
                  <div className={cx("kv__row", balance > 0 && "order-summary__balance")}>
                    <span className="kv__label">Balance</span>
                    <span className="kv__value">{inr(balance, 2)}</span>
                  </div>
                </>
              ) : null}
            </div>

            {status === "PREPARED" && !bill ? (
              <div className="order-next">
                <p>Kitchen is done. Generate the bill to open the payment counter.</p>
                <Button className="btn--block" icon={ReceiptText} onClick={() => setBillOpen(true)}>Generate bill</Button>
              </div>
            ) : null}
            {status === "PLACED" ? (
              <div className="order-next">
                <p>Let the kitchen know this ticket has started.</p>
                <Button className="btn--block" icon={Play} loading={acting === "PREPARING"} onClick={() => performStatus("PREPARING", "Kitchen started")}>
                  Start preparing
                </Button>
              </div>
            ) : null}
            {status === "PREPARING" ? (
              <div className="order-next">
                <p>When every dish is plated, mark the order prepared.</p>
                <Button className="btn--block" icon={CheckCheck} loading={acting === "PREPARED"} onClick={() => performStatus("PREPARED", "Order prepared")}>
                  Mark prepared
                </Button>
              </div>
            ) : null}
            {bill && !isSettled ? (
              <div className="order-next">
                <p>{inr(balance, 2)} remains. Split payments are supported.</p>
                <LinkButton to={`/bills/${bill.bill_id}`} className="btn--block" icon={Wallet}>Settle bill</LinkButton>
              </div>
            ) : null}
            {isSettled ? (
              <div className="order-settled">
                <CheckCheck size={16} />
                <span>{status === "CLOSED" ? "Settled and closed" : "Bill fully paid"}</span>
              </div>
            ) : null}
            {status === "CANCELLED" ? (
              <div className="order-cancelled">
                <Ban size={15} /> This order was cancelled. No revenue was recorded.
              </div>
            ) : null}

            {bill?.payments?.length ? (
              <div className="order-payment-list">
                <p className="order-payment-list__label">Payments</p>
                {bill.payments.map((payment) => (
                  <div key={payment.payment_id}>
                    <span className={cx("mode-dot", `mode-${payment.payment_mode.toLowerCase()}`)} />
                    <span>{payment.payment_mode}</span>
                    <small>{formatDateTime(payment.payment_date)}</small>
                    <strong>{inr(payment.amount, 2)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Service context" icon={User} />
            <div className="kv">
              <div className="kv__row"><span className="kv__label">Table</span><span className="kv__value">{order.table_id ? `Table ${order.table_id} · ${order.table_capacity} seats` : "Counter"}</span></div>
              <div className="kv__row"><span className="kv__label">Waiter</span><span className="kv__value">{order.waiter_name}</span></div>
              <div className="kv__row"><span className="kv__label">Cashier</span><span className="kv__value">{order.cashier_name || "Not assigned"}</span></div>
              <div className="kv__row"><span className="kv__label">Guest</span><span className="kv__value">{order.customer_name || "Walk-in"}{order.customer_phone ? ` · ${order.customer_phone}` : ""}</span></div>
              <div className="kv__row"><span className="kv__label">Placed</span><span className="kv__value">{formatDateTime(order.placed_at)}</span></div>
              <div className="kv__row"><span className="kv__label">Prepared</span><span className="kv__value">{order.prepared_at ? formatDateTime(order.prepared_at) : "—"}</span></div>
              {order.prepared_at ? (
                <div className="kv__row">
                  <span className="kv__label">Prep time</span>
                  <span className="kv__value">{formatDuration((new Date(order.prepared_at) - new Date(order.placed_at)) / 1000)}</span>
                </div>
              ) : null}
              <div className="kv__row"><span className="kv__label">Closed</span><span className="kv__value">{order.closed_at ? formatDateTime(order.closed_at) : "—"}</span></div>
            </div>
            <div className="order-sync-note">
              <Sparkles size={12} />
              Writes land in MySQL, then flow through the outbox to TimescaleDB.
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel order #${order.order_id}?`}
        description="This releases the table and stops the ticket. It cannot be undone."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep order</Button>
            <Button variant="danger" icon={Ban} loading={acting === "CANCELLED"} onClick={cancelOrder}>Cancel order</Button>
          </>
        }
      >
        <p className="modal-copy">
          The cancellation is recorded as an event, so it appears in the analytics funnel. If the order should remain on the floor, keep it open instead.
        </p>
      </Modal>

      <Modal
        open={billOpen}
        onClose={() => !acting && setBillOpen(false)}
        title="Generate the bill"
        description={`Order #${order.order_id} · ${items.length} lines. Review the tax and discount before opening the payment counter.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBillOpen(false)} disabled={Boolean(acting)}>Cancel</Button>
            <Button icon={ReceiptText} loading={acting === "BILL"} onClick={generateBill}>
              Generate {inr(preview.grand, 2)}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="GST / tax rate (%)" htmlFor="bill-tax">
            <Input
              id="bill-tax"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={billForm.tax_rate}
              onChange={(event) => setBillForm({ ...billForm, tax_rate: event.target.value })}
            />
          </Field>
          <Field label="Discount (%)" htmlFor="bill-discount" hint="Optional goodwill or loyalty discount.">
            <Input
              id="bill-discount"
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={billForm.discount_pct}
              onChange={(event) => setBillForm({ ...billForm, discount_pct: event.target.value })}
            />
          </Field>
        </div>
        <div className="bill-preview">
          <div><span>Subtotal</span><strong>{inr(preview.subtotal, 2)}</strong></div>
          <div><span>Tax</span><strong>{inr(preview.tax, 2)}</strong></div>
          {preview.discount > 0 ? <div><span>Discount</span><strong>−{inr(preview.discount, 2)}</strong></div> : null}
          <div className="bill-preview__grand"><span>Grand total</span><strong>{inr(preview.grand, 2)}</strong></div>
        </div>
      </Modal>

      <Modal
        open={itemsOpen}
        onClose={() => !acting && setItemsOpen(false)}
        title="Add to this ticket"
        description="Only available before the bill. Added lines emit their own item events."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setItemsOpen(false)} disabled={Boolean(acting)}>Close</Button>
            <Button icon={Plus} onClick={addItems} loading={acting === "ITEMS"} disabled={!addCount || !addChef}>
              Add {addCount || ""} {addCount === 1 ? "item" : "items"}{addCount ? ` · ${inr(addTotal)}` : ""}
            </Button>
          </>
        }
      >
        <div className="add-items">
          <div className="add-items__toolbar">
            <div className="search">
              <Search size={15} />
              <input
                className="search__input"
                type="search"
                placeholder="Find a dish"
                value={addSearch}
                onChange={(event) => setAddSearch(event.target.value)}
              />
            </div>
            <Select value={addChef} onChange={(event) => setAddChef(event.target.value)} aria-label="Chef for added dishes">
              <option value="">Select chef</option>
              {chefList.map((chef) => (
                <option key={chef.staff_id} value={chef.staff_id}>{chef.name}</option>
              ))}
            </Select>
          </div>
          {menu.loading && !menu.data ? (
            <Loading label="Fetching the menu" rows={4} />
          ) : filteredMenu.length === 0 ? (
            <EmptyState icon={ChefHat} title="No dishes found" description="Try another search." />
          ) : (
            <div className="add-items__list">
              {filteredMenu.map((item) => {
                const quantity = addQty[item.item_id] || 0;
                return (
                  <div className={cx("add-item", quantity > 0 && "is-selected")} key={item.item_id}>
                    <span className={cx("veg-mark", !item.is_veg && "veg-mark--nonveg")} />
                    <div className="add-item__body">
                      <span>{item.name}</span>
                      <small>{item.category_name} · {inr(item.price)}</small>
                    </div>
                    <div className="stepper">
                      <button type="button" onClick={() => changeAdd(item, -1)} disabled={!quantity} aria-label={`Remove one ${item.name}`}><Minus size={12} /></button>
                      <span>{quantity}</span>
                      <button type="button" onClick={() => changeAdd(item, 1)} aria-label={`Add one ${item.name}`}><Plus size={12} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
