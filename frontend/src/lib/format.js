const TZ = "Asia/Kolkata";

const inrFormatter = (decimals) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export function inr(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return inrFormatter(decimals).format(Number(value));
}

export function inrExact(value) {
  return inr(value, 2);
}

export function inrCompact(value) {
  const number = Number(value) || 0;
  const sign = number < 0 ? "−" : "";
  const abs = Math.abs(number);
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)} L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

function trim(value) {
  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return rounded.replace(/\.0$/, "");
}

export function num(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(Number(value));
}

export function pct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(digits).replace(/\.0$/, "")}%`;
}

export function signedPct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const prefix = Number(value) > 0 ? "+" : "";
  return `${prefix}${Number(value).toFixed(digits).replace(/\.0$/, "")}%`;
}

const dateFormatter = (options) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...options });

export function formatDate(value, style = "medium") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const options =
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : style === "short"
        ? { day: "2-digit", month: "short" }
        : { day: "numeric", month: "short", year: "numeric" };
  return dateFormatter(options).format(date);
}

export function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateFormatter({ hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "—";
  return `${formatDate(value, "short")} · ${formatTime(value)}`;
}

export function formatClock(value = new Date()) {
  return dateFormatter({ weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
}

export function fromNow(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 60) return seconds > 0 ? `in ${abs}s` : `${abs}s ago`;
  let label = "";
  if (abs < 3600) label = `${Math.round(abs / 60)} min`;
  else if (abs < 86400) label = `${Math.round(abs / 3600)} hr`;
  else if (abs < 604800) label = `${Math.round(abs / 86400)} day${abs >= 172800 ? "s" : ""}`;
  else label = `${Math.round(abs / 604800)} wk`;
  return seconds > 0 ? `in ${label}` : `${label} ago`;
}

export function elapsedSince(value) {
  if (!value) return "—";
  const start = new Date(value).getTime();
  if (Number.isNaN(start)) return "—";
  return formatDuration(Math.max(0, Math.round((Date.now() - start) / 1000)));
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const total = Math.max(0, Math.round(Number(seconds)));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

export function greeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now)
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function istDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function dateInputValue(date = new Date()) {
  const { year, month, day } = istDateParts(date);
  return `${year}-${month}-${day}`;
}

export function dateInputDaysAgo(days) {
  const { year, month, day } = istDateParts();
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - days));
  return shifted.toISOString().slice(0, 10);
}

export const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function hourLabel(hour) {
  const h = Number(hour);
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
