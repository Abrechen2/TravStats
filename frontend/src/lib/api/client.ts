import axios, { type AxiosError } from "axios";

import { API_TIMEOUTS } from "../../config/constants";
import { attachGatewayRetry } from "./gatewayRetry";

export const API_URL = import.meta.env?.VITE_API_URL || "";

// Standard API instance with 10s timeout for normal requests
export const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : "/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: API_TIMEOUTS.DEFAULT,
  withCredentials: true, // Send cookies with every request (HttpOnly JWT)
});

// Parser API instance with 180s timeout for long-running parser operations
export const parserApi = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : "/api/v1",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: API_TIMEOUTS.PARSER,
  withCredentials: true,
});

// Response interceptor for handling 401 errors (expired/invalid tokens)
// Uses event-based approach to avoid circular dependencies
const handle401Error = (error: AxiosError): Promise<never> => {
  if (error.response?.status === 401) {
    // Token expired or invalid - dispatch event for auth store to handle
    // This avoids circular dependency between api.ts and authStore.ts
    const event = new CustomEvent("auth:unauthorized", {
      detail: { error },
    });
    window.dispatchEvent(event);

    // Fallback: if React/authStore didn't clear the user within 500ms, do it here.
    // Clears localStorage before redirecting so /login doesn't bounce back to /.
    setTimeout(() => {
      try {
        const publicPaths = new Set(["/login", "/register", "/setup"]);
        if (publicPaths.has(window.location.pathname)) return;

        const raw = localStorage.getItem("auth-storage");
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        const hasUser = !!(
          typeof parsed === "object" &&
          parsed !== null &&
          "state" in parsed &&
          typeof (parsed as { state: unknown }).state === "object" &&
          (parsed as { state: { user?: unknown } }).state !== null &&
          (parsed as { state: { user?: unknown } }).state?.user
        );
        if (hasUser) {
          // Clear auth state before redirecting to prevent /login → / bounce loop
          try {
            const data = parsed as { state: { user: unknown }; version: number };
            data.state.user = null;
            localStorage.setItem("auth-storage", JSON.stringify(data));
          } catch {
            localStorage.removeItem("auth-storage");
          }
          window.location.href = "/login";
        }
      } catch {
        localStorage.removeItem("auth-storage");
        window.location.href = "/login";
      }
    }, 500);
  }
  return Promise.reject(error);
};

// Attach gateway-retry BEFORE handle401Error. Axios runs response error
// interceptors in REVERSE attach order, so handle401Error runs first; for any
// non-401 it just re-rejects (it's a passthrough), letting the rejection reach
// gateway-retry which then retries idempotent reads on transient 5xx /
// network errors. Net effect: 401s short-circuit to login, 5xx/network
// errors are silently retried.
attachGatewayRetry(api);
attachGatewayRetry(parserApi);

api.interceptors.response.use((response) => response, handle401Error);
parserApi.interceptors.response.use((response) => response, handle401Error);

export default api;
