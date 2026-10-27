import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Banknote,
  CheckCheck,
  CreditCard,
  Globe2,
  Printer,
  Receipt,
  RefreshCw,
  Smartphone,
  Sparkles,
  Wallet,
} from "lucide-react";
import { api, useFetch } from "../lib/api";
import { PAYMENT_MODES } from "../lib/constants";
import { formatDate, formatDateTime, formatTime, fromNow, inr } from "../lib/format";
import { cx } from "../lib/utils";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  PaymentBadge,
  Select,
} from "../components/UI";

const MODE_ICONS = {
  CASH: Banknote,
  CARD: CreditCard,
  UPI: Smartphone,
  ONLINE: Globe2,
};

export default function BillDetail() {
  const { billId } = useParams();
  const toast = useToast();
  const { data, error, loading, refresh } = useFetch(`/bills/${billId}`, { poll: 20000 });
  const cashiers = useFetch("/staff?role=CASHIER&active=1");
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("UPI");
  const [cashierId, setCashierId] = useState("");
  const [saving, setSaving] = useState(false);
  const [amountError, setAmountError] = useState("");

  const bill = data?.bill;
  const items = data?.items || [];
  const payments = data?.payments || [];
  const balance = Number(bill?.balance || 0);
  const paid = Number(bill?.paid_amount || 0);
  const settled = bill?.payment_status === "PAID" || bill?.order_status === "CLOSED";
  const cashierList = cashiers.data?.staff || [];

  useEffect(() => {
    if (!cashierId && cashierList.length) setCashierId(String(cashierList[0].staff_id));
  }, [cashierId, cashierList]);

  const modeBreakdown = useMemo(() => {
    const totals = {};
    for (const payment of payments) {
      totals[payment.payment_mode] = (totals[payment.payment_mode] || 0) + Number(payment.amount);
    }
    return totals;
  }, [payments]);

  function openPayment(quickAmount) {
    if (!bill) return;
    setAmount(String(quickAmount ?? balance.toFixed(2)));
    setAmountError("");
    setPayOpen(true);
  }

  function handleAmount(value) {
    setAmount(value);
    const numeric = Number(value);
    if (!value || Number.isNaN(numeric) || numeric <= 0) setAmountError("Enter an amount greater than zero.");
    else if (numeric > balance + 0.001) setAmountError(`The balance is ${inr(balance, 2)}.`);
    else setAmountError("");
  }

  async function recordPayment() {
    const numeric = Number(amount);
    if (!numeric || numeric <= 0) {
      setAmountError("Enter an amount greater than zero.");
      return;
    }
    if (numeric > balance + 0.001) {
      setAmountError(`The balance is ${inr(balance, 2)}.`);
      return;
    }
    setSaving(true);
    try {
      const response = await api.post(`/bills/${billId}/payments`, {
        amount: numeric,
        payment_mode: mode,
        cashier_id: cashierId ? Number(cashierId) : null,
      });
      const updated = response.bill.bill;
      setPayOpen(false);
      if (updated.payment_status === "PAID") {
        toast.success("Bill settled", `${inr(updated.grand_total, 2)} collected. The table has been released and the order closed.`);
      } else {
        toast.success("Payment recorded", `${inr(numeric, 2)} via ${mode}. Balance is now ${inr(updated.balance, 2)}.`);
      }
      refresh();
    } catch (requestError) {
      toast.error("Payment could not be recorded", requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Receipt" title={`Bill #${billId}`} description="Loading the bill, line items and payment history…" />
        {error ? (
          <ErrorState error={error} onRetry={refresh} title="This bill could not be loaded" />
        ) : (
          <Card><Loading label="Opening the payment counter" rows={5} /></Card>
        )}
      </div>
    );
  }

  return (
    <div className="page bill-detail">
      <div className="backline no-print">
        <Link to="/billing" className="backlink">
          <ArrowLeft size={14} /> Billing
        </Link>
        <div className="row">
          <button type="button" className="icon-btn" onClick={refresh} title="Refresh bill">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
          <Button variant="outline" icon={Printer} onClick={() => window.print()}>Print receipt</Button>
        </div>
      </div>

      <PageHeader
        eyebrow="Payment counter"
        title={
          <span className="title-with-badge">
            Bill #{bill.bill_id}
            <PaymentBadge value={bill.payment_status} />
          </span>
        }
        description={
          <span className="order-subline">
            <span>Order #{bill.order_id}</span>
            {bill.table_id ? <span>Table {bill.table_id}</span> : <span>{bill.order_type.replace("_", " ").toLowerCase()}</span>}
            <span>{formatDateTime(bill.generated_at)}</span>
            {settled ? <span>Closed</span> : <span>{inr(balance, 2)} remaining</span>}
          </span>
        }
        actions={
          !settled ? (
            <Button icon={Wallet} onClick={() => openPayment()}>Record payment</Button>
          ) : (
            <Link to={`/orders/${bill.order_id}`} className="btn btn--outline">
              <Receipt size={15} />
              <span>View order</span>
            </Link>
          )
        }
      />

      <div className="receipt-layout">
        <div className="receipt-sheet">
          <div className="receipt-brand">
            <span className="receipt-brand__mark">
              <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r="27" fill="none" stroke="#c9873f" strokeWidth="1.6" />
                <path d="M32 14c5 7 5 12 0 18-5-6-5-11 0-18Z" fill="#c9873f" />
                <path d="M32 50c-5-7-5-12 0-18 5 6 5 11 0 18Z" fill="#a78a68" />
                <circle cx="32" cy="32" r="3" fill="#c9873f" />
              </svg>
            </span>
            <p className="receipt-brand__eyebrow">Saffron House</p>
            <h2>Fine Indian dining</h2>
            <p className="receipt-brand__address">Indiranagar · Bengaluru · Asia/Kolkata</p>
          </div>

          <div className="receipt-meta">
            <div>
              <span>Bill no.</span>
              <strong>#{bill.bill_id}</strong>
            </div>
            <div>
              <span>Date</span>
              <strong>{formatDate(bill.generated_at)}</strong>
            </div>
            <div>
              <span>Time</span>
              <strong>{formatTime(bill.generated_at)}</strong>
            </div>
            <div>
              <span>Order</span>
              <strong>#{bill.order_id}</strong>
            </div>
            <div>
              <span>Table</span>
              <strong>{bill.table_id ? `Table ${bill.table_id}` : bill.order_type.replace("_", " ")}</strong>
            </div>
            <div>
              <span>Waiter</span>
              <strong>{bill.waiter_name}</strong>
            </div>
            {bill.customer_name ? (
              <div>
                <span>Guest</span>
                <strong>{bill.customer_name}</strong>
              </div>
            ) : null}
            <div>
              <span>Cashier</span>
              <strong>{bill.cashier_name || "Counter"}</strong>
            </div>
          </div>

          <div className="receipt-items">
            <div className="receipt-items__head">
              <span>Item</span>
              <span>Qty</span>
              <span>Rate</span>
              <span>Amount</span>
            </div>
            {items.map((item) => (
              <div className="receipt-line" key={item.line_no}>
                <div>
                  <span className={cx("veg-mark", !item.is_veg && "veg-mark--nonveg")} />
                  <div>
                    <span>{item.item_name}</span>
                    <small>{item.category_name} · {item.chef_name}</small>
                  </div>
                </div>
                <span>{item.quantity}</span>
                <span>{inr(item.price_at_order, 2)}</span>
                <strong>{inr(item.line_total, 2)}</strong>
              </div>
            ))}
          </div>

          <div className="receipt-totals">
            <div><span>Subtotal</span><strong>{inr(bill.subtotal, 2)}</strong></div>
            <div><span>Tax</span><strong>{inr(bill.tax, 2)}</strong></div>
            {Number(bill.discount_amount) > 0 ? (
              <div><span>Discount</span><strong>−{inr(bill.discount_amount, 2)}</strong></div>
            ) : null}
            <div className="receipt-totals__grand"><span>Grand total</span><strong>{inr(bill.grand_total, 2)}</strong></div>
            <div className="receipt-totals__paid"><span>Paid</span><strong>{inr(paid, 2)}</strong></div>
            {balance > 0 ? (
              <div className="receipt-totals__balance"><span>Balance due</span><strong>{inr(balance, 2)}</strong></div>
            ) : null}
          </div>

          {payments.length ? (
            <div className="receipt-payments">
              <p>Payments</p>
              {payments.map((payment) => (
                <div key={payment.payment_id}>
                  <span>{payment.payment_mode}</span>
                  <small>{formatDateTime(payment.payment_date)}</small>
                  <strong>{inr(payment.amount, 2)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <div className={cx("receipt-stamp", settled ? "is-paid" : "is-open")}>
            {settled ? <><CheckCheck size={16} /> Paid in full</> : <><Wallet size={16} /> Balance due</>}
          </div>

          <div className="receipt-foot">
            <p>Thank you for dining at Saffron House.</p>
            <span>Revenue is recognised at bill generation; settlements are recorded separately.</span>
            <span className="receipt-foot__id">BILL #{bill.bill_id} · ORDER #{bill.order_id} · SAFFRON HOUSE DA3</span>
          </div>
        </div>

        <aside className="receipt-side no-print">
          <Card className={cx("payment-panel", settled && "is-settled")}>
            <div className="payment-panel__head">
              <div>
                <p className="eyebrow">{settled ? "Settled" : "Amount due"}</p>
                <h2>{inr(settled ? bill.grand_total : balance, 2)}</h2>
              </div>
              {settled ? (
                <span className="paid-seal"><CheckCheck size={17} /> Paid</span>
              ) : (
                <Badge tone="amber" dot>Open tab</Badge>
              )}
            </div>

            <div className="payment-progress">
              <div className="payment-progress__labels">
                <span>{inr(paid, 2)} paid</span>
                <span>{inr(bill.grand_total, 2)} total</span>
              </div>
              <div className="payment-progress__bar">
                <span style={{ width: `${Math.min(100, (paid / Math.max(Number(bill.grand_total), 1)) * 100)}%` }} />
              </div>
            </div>

            {!settled ? (
              <>
                <Button size="lg" className="btn--block" icon={Wallet} onClick={() => openPayment()}>
                  Collect {inr(balance, 2)}
                </Button>
                <p className="payment-panel__hint">
                  Split across cash, card, UPI or online. The order closes automatically on the final payment.
                </p>
              </>
            ) : (
              <div className="payment-panel__done">
                <CheckCheck size={16} />
                <span>Order #{bill.order_id} is {bill.order_status.toLowerCase()} and the table is free.</span>
              </div>
            )}

            {payments.length ? (
              <div className="mode-breakdown">
                {Object.entries(modeBreakdown).map(([paymentMode, total]) => {
                  const Icon = MODE_ICONS[paymentMode] || Banknote;
                  return (
                    <div key={paymentMode}>
                      <span className={cx("mode-icon", `mode-${paymentMode.toLowerCase()}`)}><Icon size={13} /></span>
                      <span>{paymentMode}</span>
                      <strong>{inr(total, 2)}</strong>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Payment history"
              subtitle={`${payments.length} successful ${payments.length === 1 ? "payment" : "payments"}`}
              icon={Receipt}
            />
            {payments.length === 0 ? (
              <div className="payment-empty">
                <span><Wallet size={18} /></span>
                <p>No payments yet</p>
                <small>Record the first payment to start settling this bill.</small>
              </div>
            ) : (
              <ul className="payment-history">
                {payments.map((payment) => {
                  const Icon = MODE_ICONS[payment.payment_mode] || Banknote;
                  return (
                    <li key={payment.payment_id}>
                      <span className={cx("mode-icon", `mode-${payment.payment_mode.toLowerCase()}`)}><Icon size={14} /></span>
                      <div>
                        <span>{payment.payment_mode}</span>
                        <small>{formatDateTime(payment.payment_date)} · {fromNow(payment.payment_date)}</small>
                      </div>
                      <strong>{inr(payment.amount, 2)}</strong>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Operational trail" icon={Sparkles} />
            <ol className="mini-trail">
              <li className="is-done">
                <span />
                <div><strong>Order prepared</strong><small>{bill.prepared_at ? formatDateTime(bill.prepared_at) : "—"}</small></div>
              </li>
              <li className="is-done">
                <span />
                <div><strong>Bill generated</strong><small>{formatDateTime(bill.generated_at)}</small></div>
              </li>
              <li className={cx(settled && "is-done")}>
                <span />
                <div><strong>Payment collected</strong><small>{settled ? "Balance cleared" : `${inr(balance, 2)} remaining`}</small></div>
              </li>
              <li className={cx(settled && "is-done")}>
                <span />
                <div><strong>Table released</strong><small>{settled ? "Triggered on full payment" : "Waiting for settlement"}</small></div>
              </li>
            </ol>
            <div className="trail-note">
              <Link to={`/orders/${bill.order_id}`} className="link">Open the order ticket</Link>
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={payOpen}
        onClose={() => !saving && setPayOpen(false)}
        title={`Collect payment · bill #${bill.bill_id}`}
        description={`${inr(balance, 2)} remains. Payments can be split across modes.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayOpen(false)} disabled={saving}>Cancel</Button>
            <Button icon={Wallet} onClick={recordPayment} loading={saving} disabled={Boolean(amountError) || !amount}>
              Record {amount ? inr(Number(amount), 2) : "payment"}
            </Button>
          </>
        }
      >
        <div className="payment-form">
          <Field label="Amount" htmlFor="payment-amount" error={amountError} hint={`Outstanding balance: ${inr(balance, 2)}`}>
            <Input
              id="payment-amount"
              type="number"
              min="0.01"
              max={balance}
              step="0.01"
              value={amount}
              onChange={(event) => handleAmount(event.target.value)}
              autoFocus
            />
          </Field>
          <div className="quick-amounts">
            <button type="button" onClick={() => handleAmount((balance / 4).toFixed(2))}>25%</button>
            <button type="button" onClick={() => handleAmount((balance / 2).toFixed(2))}>Half</button>
            <button type="button" onClick={() => handleAmount(balance.toFixed(2))}>Full balance</button>
          </div>

          <Field label="Payment mode">
            <div className="payment-modes">
              {PAYMENT_MODES.map((paymentMode) => {
                const Icon = MODE_ICONS[paymentMode];
                return (
                  <button
                    key={paymentMode}
                    type="button"
                    className={cx("payment-mode", mode === paymentMode && "is-active", `mode-${paymentMode.toLowerCase()}`)}
                    onClick={() => setMode(paymentMode)}
                  >
                    <Icon size={17} />
                    <span>{paymentMode}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Cashier" htmlFor="payment-cashier">
            <Select id="payment-cashier" value={cashierId} onChange={(event) => setCashierId(event.target.value)}>
              <option value="">Counter (unassigned)</option>
              {cashierList.map((cashier) => (
                <option key={cashier.staff_id} value={cashier.staff_id}>
                  {cashier.name}{cashier.counter_no ? ` · Counter ${cashier.counter_no}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <div className="payment-summary">
            <div><span>Bill total</span><strong>{inr(bill.grand_total, 2)}</strong></div>
            <div><span>Already paid</span><strong>{inr(paid, 2)}</strong></div>
            <div><span>This payment</span><strong>{inr(Number(amount) || 0, 2)}</strong></div>
            <div className="payment-summary__balance"><span>Balance after</span><strong>{inr(Math.max(0, balance - (Number(amount) || 0)), 2)}</strong></div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
