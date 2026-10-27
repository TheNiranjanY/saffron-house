export const ORDER_STATUS = {
  PLACED: { label: "Placed", tone: "amber" },
  PREPARING: { label: "Preparing", tone: "blue" },
  PREPARED: { label: "Prepared", tone: "green" },
  BILLED: { label: "Billed", tone: "violet" },
  CLOSED: { label: "Closed", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};

export const PAYMENT_STATUS = {
  UNPAID: { label: "Unpaid", tone: "red" },
  PARTIAL: { label: "Part paid", tone: "amber" },
  PAID: { label: "Paid", tone: "green" },
};

export const ORDER_TYPE = {
  DINE_IN: { label: "Dine in", tone: "saffron" },
  TAKEAWAY: { label: "Takeaway", tone: "blue" },
  DELIVERY: { label: "Delivery", tone: "violet" },
};

export const PAYMENT_MODE = {
  CASH: { label: "Cash", color: "#B77A3A" },
  CARD: { label: "Card", color: "#486B63" },
  UPI: { label: "UPI", color: "#C9761A" },
  ONLINE: { label: "Online", color: "#7F5C74" },
};

export const PAYMENT_MODES = ["CASH", "CARD", "UPI", "ONLINE"];

export const EVENT_LABEL = {
  ORDER_PLACED: "Order placed",
  ITEM_ADDED: "Items added",
  ORDER_PREPARING: "Kitchen started",
  ORDER_PREPARED: "Order prepared",
  BILL_GENERATED: "Bill generated",
  PAYMENT_RECEIVED: "Payment received",
  ORDER_CLOSED: "Order closed",
  ORDER_CANCELLED: "Order cancelled",
};

export const EVENT_TONE = {
  ORDER_PLACED: "amber",
  ITEM_ADDED: "saffron",
  ORDER_PREPARING: "blue",
  ORDER_PREPARED: "green",
  BILL_GENERATED: "violet",
  PAYMENT_RECEIVED: "teal",
  ORDER_CLOSED: "neutral",
  ORDER_CANCELLED: "red",
};

export const CHART = {
  saffron: "#C9761A",
  saffronLight: "#E7A94E",
  saffronFade: "#F3D9AD",
  wine: "#8E3F35",
  olive: "#5C7355",
  espresso: "#4A3427",
  toffee: "#9C6B45",
  cream: "#F6EBD8",
  grid: "#EADCC7",
  axis: "#9C8876",
};

export const DONUT_COLORS = ["#C9761A", "#486B63", "#8E3F35", "#D9A441", "#7F5C74", "#9C6B45"];

export function statusMeta(map, value) {
  return map[value] || { label: value || "—", tone: "neutral" };
}
