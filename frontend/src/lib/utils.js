export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function sum(items, pick = (item) => item) {
  return items.reduce((total, item) => total + Number(pick(item) || 0), 0);
}

export function groupBy(items, pick) {
  return items.reduce((groups, item) => {
    const key = pick(item);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
}

export function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
