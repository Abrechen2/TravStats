import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachGatewayRetry } from "./gatewayRetry";

/**
 * Custom Axios adapter that returns a sequence of canned responses per URL+method.
 * Avoids axios-mock-adapter / msw / nock — keeps the test stack thin.
 */
function makeSequenceAdapter(sequence: Array<{ status: number } | { networkError: true }>) {
  let i = 0;
  return async (config: InternalAxiosRequestConfig) => {
    const next = sequence[i++] ?? sequence[sequence.length - 1];
    if ("networkError" in next) {
      const err = new Error("Network Error") as Error & { code?: string; config?: unknown };
      err.code = "ERR_NETWORK";
      err.config = config;
      throw err;
    }
    if (next.status >= 400) {
      const err = new Error(`HTTP ${next.status}`) as Error & {
        response?: { status: number };
        config?: unknown;
      };
      err.response = { status: next.status };
      err.config = config;
      throw err;
    }
    return {
      data: { ok: true },
      status: next.status,
      statusText: "OK",
      headers: {},
      config,
    };
  };
}

function makeInstance(adapter: ReturnType<typeof makeSequenceAdapter>): AxiosInstance {
  const instance = axios.create({ baseURL: "/api/v1", adapter });
  attachGatewayRetry(instance, { baseDelayMs: 1, maxRetries: 3 });
  return instance;
}

describe("attachGatewayRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries GET on 502 and succeeds on the 3rd attempt", async () => {
    const adapter = makeSequenceAdapter([{ status: 502 }, { status: 502 }, { status: 200 }]);
    const api = makeInstance(adapter);
    const result = await api.get("/flights");
    expect(result.status).toBe(200);
  });

  it("gives up after MAX_RETRIES on persistent 502", async () => {
    const adapter = makeSequenceAdapter([{ status: 502 }]);
    const api = makeInstance(adapter);
    await expect(api.get("/flights")).rejects.toMatchObject({
      response: { status: 502 },
    });
  });

  it("retries on ERR_NETWORK (connection refused during boot)", async () => {
    const adapter = makeSequenceAdapter([{ networkError: true }, { status: 200 }]);
    const api = makeInstance(adapter);
    const result = await api.get("/flights");
    expect(result.status).toBe(200);
  });

  it("does NOT retry POST (non-idempotent)", async () => {
    let calls = 0;
    const adapter = async (config: InternalAxiosRequestConfig) => {
      calls++;
      const err = new Error("HTTP 502") as Error & { response?: { status: number }; config?: unknown };
      err.response = { status: 502 };
      err.config = config;
      throw err;
    };
    const api = makeInstance(adapter);
    await expect(api.post("/flights", { foo: 1 })).rejects.toMatchObject({
      response: { status: 502 },
    });
    expect(calls).toBe(1);
  });

  it("does NOT retry on 4xx", async () => {
    let calls = 0;
    const adapter = async (config: InternalAxiosRequestConfig) => {
      calls++;
      const err = new Error("HTTP 401") as Error & { response?: { status: number }; config?: unknown };
      err.response = { status: 401 };
      err.config = config;
      throw err;
    };
    const api = makeInstance(adapter);
    await expect(api.get("/flights")).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(calls).toBe(1);
  });
});
