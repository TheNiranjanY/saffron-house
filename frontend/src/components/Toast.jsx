import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    ({ type = "success", title, message = "" }) => {
      const id = ++idRef.current;
      setToasts((items) => [...items.slice(-3), { id, type, title, message }]);
      window.setTimeout(() => dismiss(id), type === "error" ? 7000 : 4500);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (title, message) => push({ type: "success", title, message }),
      error: (title, message) => push({ type: "error", title, message }),
      info: (title, message) => push({ type: "info", title, message }),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] || Info;
          return (
            <div key={toast.id} className={`toast toast--${toast.type}`} role="status">
              <span className="toast__icon">
                <Icon size={18} strokeWidth={2} />
              </span>
              <div className="toast__body">
                <p className="toast__title">{toast.title}</p>
                {toast.message ? <p className="toast__message">{toast.message}</p> : null}
              </div>
              <button
                type="button"
                className="toast__close"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
