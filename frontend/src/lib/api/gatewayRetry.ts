import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
const RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ERR_NETWORK",
]);
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["get", "head", "options"]);

interface RetryConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

interface RetryOptions {
  /** Initial delay in ms; doubles each retry. */
  baseDelayMs?: number;
  /** Maximum retry attempts after the initial request. */
  maxRetries?: number;
}

/**
 * Mounts a response interceptor on `instance` that retries idempotent verbs
 * (GET/HEAD/OPTIONS) when the server returns 502/503/504 or the request fails
 * with a transient network error. Backs off exponentially.
 *
 * Defends the frontend against the boot window where nginx is up but Express
 * is still applying migrations — without this, the Zustand stores latch onto
 * the first 502 and never refetch until the user hard-reloads.
 *
 * Idempotency check is method-based; we never auto-retry POST/PUT/PATCH/DELETE
 * so a partially-applied write isn't accidentally repeated.
 */
export function attachGatewayRetry(
  instance: AxiosInstance,
  options: RetryOptions = {},
): void {
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxRetries = options.maxRetries ?? 3;

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetryConfig | undefined;
      if (!config) return Promise.reject(error);

      const status = error.response?.status;
      const isStatusRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);
      const isNetworkRetryable =
        error.code !== undefined && RETRYABLE_NETWORK_CODES.has(error.code);
      const method = (config.method ?? "get").toLowerCase();
      const isIdempotent = IDEMPOTENT_METHODS.has(method);

      if (!(isStatusRetryable || isNetworkRetryable) || !isIdempotent) {
        return Promise.reject(error);
      }

      const attempt = (config.__retryCount ?? 0) + 1;
      if (attempt > maxRetries) {
        return Promise.reject(error);
      }
      config.__retryCount = attempt;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return instance.request(config);
    },
  );
}
