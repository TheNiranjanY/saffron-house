import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { ORDER_STATUS, PAYMENT_STATUS, statusMeta } from "../lib/constants";
import { cx } from "../lib/utils";

export function buttonClass({ variant = "primary", size = "md", className = "" } = {}) {
  return cx("btn", `btn--${variant}`, `btn--${size}`, className);
}

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconAfter: IconAfter,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}) {
  return (
    <button
      type="button"
      className={buttonClass({ variant, size, className })}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
      {children ? <span>{children}</span> : null}
      {IconAfter ? <IconAfter size={15} /> : null}
    </button>
  );
}

export function LinkButton({ to, variant = "primary", size = "md", icon: Icon, className, children, ...rest }) {
  return (
    <Link to={to} className={buttonClass({ variant, size, className })} {...rest}>
      {Icon ? <Icon size={16} /> : null}
      {children ? <span>{children}</span> : null}
    </Link>
  );
}

export function Card({ as: Tag = "section", className, children, ...rest }) {
  return (
    <Tag className={cx("card", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, actions, className }) {
  return (
    <div className={cx("card-header", className)}>
      <div className="card-header__text">
        {Icon ? (
          <span className="card-header__icon">
            <Icon size={16} />
          </span>
        ) : null}
        <div>
          <h2 className="card-header__title">{title}</h2>
          {subtitle ? <p className="card-header__subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="card-header__actions">{actions}</div> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <header className={cx("page-header", className)}>
      <div className="page-header__text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function Badge({ tone = "neutral", dot = false, className, children }) {
  return (
    <span className={cx("badge", `badge--${tone}`, className)}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ value, map = ORDER_STATUS, dot = true }) {
  const meta = statusMeta(map, value);
  return (
    <Badge tone={meta.tone} dot={dot}>
      {meta.label}
    </Badge>
  );
}

export function PaymentBadge({ value }) {
  return <StatusBadge value={value} map={PAYMENT_STATUS} />;
}

export function Trend({ value, positiveIsGood = true, label }) {
  if (value === null || value === undefined) return <span className="trend trend--flat">—</span>;
  const positive = Number(value) >= 0;
  const good = positive === positiveIsGood;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx("trend", good ? "trend--good" : "trend--bad")}>
      <Icon size={13} />
      {Math.abs(Number(value)).toFixed(1).replace(/\.0$/, "")}%
      {label ? <span className="trend__label">{label}</span> : null}
    </span>
  );
}

export function StatCard({ label, value, sub, icon: Icon, trend, trendLabel, positiveIsGood = true, tone = "saffron" }) {
  return (
    <Card className="stat">
      <div className="stat__top">
        <p className="stat__label">{label}</p>
        {Icon ? (
          <span className={cx("stat__icon", `tone-${tone}`)}>
            <Icon size={17} />
          </span>
        ) : null}
      </div>
      <p className="stat__value">{value}</p>
      <div className="stat__footer">
        {trend !== undefined ? <Trend value={trend} positiveIsGood={positiveIsGood} /> : null}
        <span className="stat__sub">{sub}</span>
      </div>
    </Card>
  );
}

export function Spinner({ size = 18, className }) {
  return <Loader2 size={size} className={cx("spin", className)} />;
}

export function Loading({ label = "Loading", rows = 1, className }) {
  return (
    <div className={cx("loading", className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton" style={{ width: `${88 - index * 9}%` }} />
      ))}
      <span className="loading__label">
        <Spinner size={14} /> {label}
      </span>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Something went wrong" }) {
  return (
    <Card className="error-state">
      <span className="error-state__icon">
        <AlertTriangle size={22} />
      </span>
      <div>
        <h3>{title}</h3>
        <p>{error?.message || "The request could not be completed."}</p>
        {error?.status === 0 ? <p className="error-state__hint">Start the API with <code>python backend/app.py</code>.</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Card>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children, className }) {
  return (
    <div className={cx("field", className)}>
      {label ? (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {hint && !error ? <p className="field__hint">{hint}</p> : null}
      {error ? <p className="field__error">{error}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }) {
  return <input className={cx("input", className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx("input", "select", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cx("input", "textarea", className)} {...rest} />;
}

export function SearchInput({ value, onChange, placeholder = "Search", className, ...rest }) {
  return (
    <div className={cx("search", className)}>
      <Search size={16} />
      <input
        type="search"
        className="search__input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = "md" }) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div className={cx("modal", `modal--${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Dialog"}>
        <div className="modal__header">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

export function Segmented({ options, value, onChange, className, size = "md" }) {
  return (
    <div className={cx("segmented", `segmented--${size}`, className)} role="group">
      {options.map((option) => {
        const item = typeof option === "object" ? option : { value: option, label: option };
        return (
          <button
            key={item.value}
            type="button"
            className={cx("segmented__btn", item.value === value && "is-active")}
            onClick={() => onChange(item.value)}
            aria-pressed={item.value === value}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx("tabs", className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={cx("tab", tab.value === value && "is-active")}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon ? <tab.icon size={15} /> : null}
          <span>{tab.label}</span>
          {tab.count !== undefined && tab.count !== null ? <span className="tab__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ total, limit, offset, onChange }) {
  if (!total) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = to < total;
  return (
    <div className="pagination">
      <p>
        Showing <strong>{from}–{to}</strong> of <strong>{total}</strong>
      </p>
      <div className="pagination__actions">
        <Button variant="outline" size="sm" icon={ChevronLeft} disabled={!hasPrev} onClick={() => onChange(Math.max(0, offset - limit))}>
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          iconAfter={ChevronRight}
          disabled={!hasNext}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled = false, id: providedId }) {
  const generatedId = useId();
  const id = providedId || generatedId;
  return (
    <label className={cx("switch", disabled && "is-disabled")} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      {label ? <span className="switch__label">{label}</span> : null}
    </label>
  );
}

export function MiniBar({ value, max, tone = "saffron" }) {
  const width = max > 0 ? Math.max(2, Math.min(100, (Number(value) / max) * 100)) : 0;
  return (
    <span className="mini-bar" aria-hidden="true">
      <span className={cx("mini-bar__fill", `mini-bar__fill--${tone}`)} style={{ width: `${width}%` }} />
    </span>
  );
}

export function Avatar({ name = "", className }) {
  const trimmed = name.trim();
  const letters = trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return <span className={cx("avatar", className)}>{letters || "?"}</span>;
}
