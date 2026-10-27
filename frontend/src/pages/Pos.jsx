import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ChefHat,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  UserPlus,
  Utensils,
} from "lucide-react";
import { api, useFetch } from "../lib/api";
import { ORDER_TYPE } from "../lib/constants";
import { inr } from "../lib/format";
import { cx, groupBy } from "../lib/utils";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Segmented,
  Select,
  Textarea,
} from "../components/UI";

const TYPES = [
  { value: "DINE_IN", label: "Dine in" },
  { value: "TAKEAWAY", label: "Takeaway" },
  { value: "DELIVERY", label: "Delivery" },
];

const TAX_RATE = 0.05;

export default function Pos() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const menu = useFetch("/menu?available=1");
  const tables = useFetch("/tables", { poll: 15000 });
  const waiters = useFetch("/staff?role=WAITER&active=1");
  const chefs = useFetch("/staff?role=CHEF&active=1");
  const customers = useFetch("/customers?limit=100");

  const [orderType, setOrderType] = useState("DINE_IN");
  const [tableId, setTableId] = useState(params.get("table") || "");
  const [waiterId, setWaiterId] = useState(params.get("waiter") || "");
  const [chefId, setChefId] = useState("");
  const [customerId, setCustomerId] = useState(params.get("customer") || "");
  const [notes, setNotes] = useState(params.get("notes") || "");
  const [cart, setCart] = useState([]);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [guestModal, setGuestModal] = useState(false);
  const [newCustomers, setNewCustomers] = useState([]);
  const [guestForm, setGuestForm] = useState({ name: "", phone: "", email: "" });
  const [guestSaving, setGuestSaving] = useState(false);

  const waiterList = waiters.data?.staff || [];
  const chefList = chefs.data?.staff || [];
  const menuItems = menu.data?.items || [];
  const menuCategories = menu.data?.categories || [];
  const freeTables = (tables.data?.tables || []).filter((table) => table.status === "FREE");
  const allCustomers = [...(customers.data?.customers || []), ...newCustomers];

  useEffect(() => {
    if (!waiterId && waiterList.length) setWaiterId(String(waiterList[0].staff_id));
  }, [waiterId, waiterList]);

  useEffect(() => {
    if (!chefId && chefList.length) setChefId(String(chefList[0].staff_id));
  }, [chefId, chefList]);

  const categoriesWithItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const visible = menuItems.filter(
      (item) =>
        (category === "all" || item.category_id === Number(category)) &&
        (!term ||
          item.name.toLowerCase().includes(term) ||
          item.description?.toLowerCase().includes(term) ||
          item.category_name.toLowerCase().includes(term))
    );
    return Object.entries(groupBy(visible, (item) => item.category_name)).map(([name, items]) => ({
      name,
      items,
    }));
  }, [menuItems, category, search]);

  const cartCount = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = cart.reduce((total, line) => total + line.quantity * line.price, 0);
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = subtotal + tax;

  function addItem(item) {
    setCart((lines) => {
      const existing = lines.find((line) => line.item_id === item.item_id);
      if (existing) {
        return lines.map((line) =>
          line.item_id === item.item_id ? { ...line, quantity: Math.min(line.quantity + 1, 50) } : line
        );
      }
      return [...lines, { item_id: item.item_id, name: item.name, price: Number(item.price), quantity: 1, is_veg: item.is_veg }];
    });
  }

  function changeQty(itemId, delta) {
    setCart((lines) =>
      lines
        .map((line) => (line.item_id === itemId ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  async function placeOrder() {
    if (!cart.length) {
      toast.error("The ticket is empty", "Add at least one dish before sending it to the kitchen.");
      return;
    }
    if (!waiterId) {
      toast.error("Pick a waiter", "Every order needs someone responsible for the table.");
      return;
    }
    if (!chefId) {
      toast.error("Pick a kitchen lead", "Choose who will receive this ticket in the kitchen.");
      return;
    }
    if (orderType === "DINE_IN" && !tableId) {
      toast.error("Pick a table", "Dine-in orders must be seated at a free table.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post("/orders", {
        order_type: orderType,
        table_id: orderType === "DINE_IN" ? Number(tableId) : null,
        waiter_id: Number(waiterId),
        customer_id: customerId ? Number(customerId) : null,
        notes: notes.trim() || null,
        items: cart.map((line) => ({
          item_id: line.item_id,
          chef_id: Number(chefId),
          quantity: line.quantity,
        })),
      });
      const order = response.order.order;
      toast.success(
        `Order #${order.order_id} is on the pass`,
        `${cartCount} item${cartCount === 1 ? "" : "s"} · ${inr(total)} · ${orderType === "DINE_IN" ? `table ${tableId}` : ORDER_TYPE[orderType].label.toLowerCase()}`
      );
      navigate(`/orders/${order.order_id}`);
    } catch (error) {
      toast.error("Could not place the order", error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function createGuest(event) {
    event.preventDefault();
    if (!guestForm.name.trim()) return;
    setGuestSaving(true);
    try {
      const response = await api.post("/customers", {
        name: guestForm.name.trim(),
        phone: guestForm.phone.trim() || null,
        email: guestForm.email.trim() || null,
      });
      setNewCustomers((people) => [...people, response.customer]);
      setCustomerId(String(response.customer.customer_id));
      setGuestModal(false);
      setGuestForm({ name: "", phone: "", email: "" });
      toast.success("Guest added", `${response.customer.name} can now be attached to the order.`);
    } catch (error) {
      toast.error("Could not add the guest", error.message);
    } finally {
      setGuestSaving(false);
    }
  }

  const menuError = menu.error && !menu.data;
  const tablesError = tables.error && !tables.data;

  return (
    <div className="page pos">
      <PageHeader
        eyebrow="Point of sale"
        title="Build a ticket."
        description="Choose the table, pick dishes for the guest, and send a single transaction to MySQL. The outbox carries the same events to TimescaleDB."
        actions={
          <>
            <Link to="/floor" className="btn btn--outline">
              <Utensils size={15} />
              <span>Table floor</span>
            </Link>
            <Link to="/orders" className="btn btn--ghost">
              <ReceiptText size={15} />
              <span>Open tickets</span>
            </Link>
          </>
        }
      />

      {(menuError || tablesError) && (
        <ErrorState
          error={menu.error || tables.error}
          onRetry={() => {
            menu.refresh();
            tables.refresh();
          }}
          title="The POS could not load its menu"
        />
      )}

      <div className="pos-layout">
        <Card className="pos-menu">
          <div className="pos-menu__header">
            <div>
              <h2>Menu</h2>
              <p>{menuItems.length} dishes available tonight</p>
            </div>
            <div className="search pos-menu__search">
              <Search size={16} />
              <input
                className="search__input"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search dishes"
              />
            </div>
          </div>

          <div className="category-chips">
            <button
              type="button"
              className={cx("category-chip", category === "all" && "is-active")}
              onClick={() => setCategory("all")}
            >
              All dishes <span>{menuItems.length}</span>
            </button>
            {menuCategories
              .filter((item) => item.available_count > 0)
              .map((item) => (
                <button
                  key={item.category_id}
                  type="button"
                  className={cx("category-chip", category === String(item.category_id) && "is-active")}
                  onClick={() => setCategory(String(item.category_id))}
                >
                  {item.category_name} <span>{item.available_count}</span>
                </button>
              ))}
          </div>

          {menu.loading && !menu.data ? (
            <Loading label="Laying out the menu" rows={5} />
          ) : categoriesWithItems.length === 0 ? (
            <EmptyState icon={ShoppingBag} title="No dishes found" description="Try a different search or category." />
          ) : (
            <div className="menu-groups">
              {categoriesWithItems.map((group) => (
                <section className="menu-group" key={group.name}>
                  <div className="menu-group__head">
                    <h3>{group.name}</h3>
                    <span>{group.items.length} dishes</span>
                  </div>
                  <div className="menu-grid">
                    {group.items.map((item) => {
                      const inCart = cart.find((line) => line.item_id === item.item_id)?.quantity || 0;
                      return (
                        <button
                          type="button"
                          className={cx("menu-pick", inCart > 0 && "is-picked")}
                          key={item.item_id}
                          onClick={() => addItem(item)}
                        >
                          <span className="menu-pick__top">
                            <span className={cx("veg-mark", !item.is_veg && "veg-mark--nonveg")} title={item.is_veg ? "Vegetarian" : "Non-vegetarian"} />
                            <span className="menu-pick__price">{inr(item.price)}</span>
                            {inCart > 0 ? <span className="menu-pick__count">{inCart}</span> : <Plus size={15} className="menu-pick__plus" />}
                          </span>
                          <span className="menu-pick__name">{item.name}</span>
                          <span className="menu-pick__desc">{item.description || item.category_name}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Card>

        <div className="pos-side">
          <Card className="pos-ticket">
            <div className="ticket-head">
              <div>
                <p className="eyebrow">New order</p>
                <h2>Ticket</h2>
              </div>
              <span className="ticket-count">{cartCount} {cartCount === 1 ? "item" : "items"}</span>
            </div>

            <Segmented options={TYPES} value={orderType} onChange={setOrderType} className="ticket-types" />

            <div className="ticket-form">
              {orderType === "DINE_IN" ? (
                <Field label="Table" htmlFor="pos-table">
                  <Select
                    id="pos-table"
                    value={tableId}
                    onChange={(event) => setTableId(event.target.value)}
                  >
                    <option value="">Choose a free table</option>
                    {freeTables.map((table) => (
                      <option key={table.table_id} value={table.table_id}>
                        Table {String(table.table_id).padStart(2, "0")} · {table.capacity} seats
                      </option>
                    ))}
                  </Select>
                  {tables.loading && !tables.data ? <span className="field__hint">Checking table availability…</span> : null}
                  {tableId && !freeTables.some((table) => String(table.table_id) === tableId) ? (
                    <span className="field__error">That table is no longer free. Pick another.</span>
                  ) : null}
                </Field>
              ) : (
                <div className="ticket-pickup">
                  <span className="ticket-pickup__icon"><ShoppingBag size={17} /></span>
                  <div>
                    <strong>{ORDER_TYPE[orderType].label} order</strong>
                    <span>No table required · settle at the counter</span>
                  </div>
                </div>
              )}

              <div className="form-grid">
                <Field label="Waiter" htmlFor="pos-waiter">
                  <Select id="pos-waiter" value={waiterId} onChange={(event) => setWaiterId(event.target.value)}>
                    <option value="">Select waiter</option>
                    {waiterList.map((person) => (
                      <option key={person.staff_id} value={person.staff_id}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Guest"
                  htmlFor="pos-guest"
                  className="pos-guest-field"
                >
                  <div className="guest-select">
                    <Select id="pos-guest" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                      <option value="">Walk-in guest</option>
                      {allCustomers.map((customer) => (
                        <option key={customer.customer_id} value={customer.customer_id}>
                          {customer.name}
                        </option>
                      ))}
                    </Select>
                    <button type="button" className="icon-btn" title="Add guest" onClick={() => setGuestModal(true)}>
                      <UserPlus size={15} />
                    </button>
                  </div>
                </Field>
              </div>

              <Field label="Send to kitchen" htmlFor="pos-chef" hint="The whole ticket is routed to this kitchen lead.">
                <Select id="pos-chef" value={chefId} onChange={(event) => setChefId(event.target.value)}>
                  <option value="">Select chef</option>
                  {chefList.map((person) => (
                    <option key={person.staff_id} value={person.staff_id}>
                      {person.name}{person.cuisine_type ? ` · ${person.cuisine_type}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Service note" htmlFor="pos-notes">
                <Textarea
                  id="pos-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Allergies, spice level, pacing…"
                  maxLength={255}
                  rows={2}
                />
              </Field>
            </div>

            <div className="ticket-divider">
              <span>On this ticket</span>
              <span>{cart.length} lines</span>
            </div>

            {cart.length === 0 ? (
              <div className="ticket-empty">
                <span><ChefHat size={20} /></span>
                <p>No dishes yet</p>
                <small>Tap a dish on the menu to start the ticket.</small>
              </div>
            ) : (
              <div className="ticket-lines">
                {cart.map((line) => (
                  <div className="ticket-line" key={line.item_id}>
                    <span className={cx("veg-mark", !line.is_veg && "veg-mark--nonveg")} />
                    <div className="ticket-line__body">
                      <div className="ticket-line__name">
                        <span>{line.name}</span>
                        <strong>{inr(line.price * line.quantity)}</strong>
                      </div>
                      <div className="ticket-line__controls">
                        <div className="stepper">
                          <button type="button" onClick={() => changeQty(line.item_id, -1)} aria-label={`Remove one ${line.name}`}>
                            <Minus size={12} />
                          </button>
                          <span>{line.quantity}</span>
                          <button type="button" onClick={() => changeQty(line.item_id, 1)} aria-label={`Add one ${line.name}`}>
                            <Plus size={12} />
                          </button>
                        </div>
                        <span className="ticket-line__unit">{inr(line.price)} each</span>
                        <button
                          type="button"
                          className="ticket-line__remove"
                          onClick={() => setCart((lines) => lines.filter((row) => row.item_id !== line.item_id))}
                          aria-label={`Remove ${line.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="ticket-totals">
              <div><span>Subtotal</span><strong>{inr(subtotal, 2)}</strong></div>
              <div><span>Tax · 5%</span><strong>{inr(tax, 2)}</strong></div>
              <div className="ticket-totals__grand"><span>Estimated total</span><strong>{inr(total, 2)}</strong></div>
            </div>

            <Button
              size="lg"
              className="btn--block"
              onClick={placeOrder}
              loading={submitting}
              disabled={!cart.length}
              icon={ArrowRight}
            >
              {submitting ? "Sending ticket…" : "Send to kitchen"}
            </Button>
            <p className="ticket-pipeline">
              <Sparkles size={12} /> MySQL transaction → outbox → TimescaleDB
            </p>
          </Card>

          <div className="pos-tip">
            <span className="pos-tip__icon"><Badge tone="saffron">Tip</Badge></span>
            <p>Tables freed on settlement. A service note rides along with the outbox event for context.</p>
          </div>
        </div>
      </div>

      <Modal
        open={guestModal}
        onClose={() => setGuestModal(false)}
        title="Add a guest"
        description="Create a lightweight guest record to attach to this order. Contact details are optional."
        footer={
          <>
            <Button variant="ghost" onClick={() => setGuestModal(false)}>Cancel</Button>
            <Button onClick={createGuest} loading={guestSaving} disabled={!guestForm.name.trim()} icon={UserPlus}>
              Add guest
            </Button>
          </>
        }
      >
        <form className="form-stack" onSubmit={createGuest}>
          <Field label="Guest name" htmlFor="guest-name">
            <Input
              id="guest-name"
              value={guestForm.name}
              onChange={(event) => setGuestForm({ ...guestForm, name: event.target.value })}
              placeholder="e.g. Ananya Rao"
              maxLength={80}
              autoFocus
            />
          </Field>
          <div className="form-grid">
            <Field label="Phone" htmlFor="guest-phone">
              <Input
                id="guest-phone"
                value={guestForm.phone}
                onChange={(event) => setGuestForm({ ...guestForm, phone: event.target.value })}
                placeholder="+91 98450 00000"
              />
            </Field>
            <Field label="Email" htmlFor="guest-email">
              <Input
                id="guest-email"
                type="email"
                value={guestForm.email}
                onChange={(event) => setGuestForm({ ...guestForm, email: event.target.value })}
                placeholder="guest@example.com"
              />
            </Field>
          </div>
          <button type="submit" className="sr-only">Add guest</button>
        </form>
      </Modal>
    </div>
  );
}
