import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function request(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  const init = { method, headers, signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${BASE}/api${path}`, init);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError("Cannot reach the API. Is Flask running on port 5001?", 0);
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `The request failed with status ${response.status}.`;
    const details = payload?.error?.details ?? payload?.details ?? null;
    throw new ApiError(message, response.status, details);
  }

  return payload;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
};

export function useFetch(path, { poll = 0, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path && enabled) });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!path || !enabled) return undefined;
    const controller = new AbortController();
    let alive = true;

    const load = async (showLoading) => {
      if (showLoading) {
        setState((previous) => ({ ...previous, loading: true, error: null }));
      }
      try {
        const data = await api.get(path, { signal: controller.signal });
        if (alive) setState({ data, error: null, loading: false });
      } catch (error) {
        if (!alive || error.name === "AbortError") return;
        setState((previous) => ({ data: previous.data, error, loading: false }));
      }
    };

    load(true);
    let timer = null;
    if (poll > 0) {
      timer = setInterval(() => {
        if (document.visibilityState === "visible") load(false);
      }, poll * 1000);
    }

    return () => {
      alive = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, poll, enabled, revision]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { ...state, refresh };
}
