import type { Config } from "./config";
import { ToolFailure, reasonForStatus } from "./errors";
import { redact } from "./redact";

export type Query = Record<string, string | number | boolean | undefined>;

export interface ApiClient {
  get<T = unknown>(path: string, query?: Query): Promise<T>;
}

type FetchLike = typeof fetch;

/** Plain REST client: bearer token, no redirects, a per-minute client budget and one polite 429 retry. */
export function createClient(
  config: Pick<Config, "apiBase" | "token" | "clientBudgetPerMinute" | "timeoutMs">,
  fetchImpl: FetchLike = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): ApiClient {
  const calls: number[] = [];

  function spendBudget(): void {
    const now = Date.now();
    while (calls.length && now - calls[0] > 60_000) calls.shift();
    if (calls.length >= config.clientBudgetPerMinute) {
      const wait = Math.ceil((60_000 - (now - calls[0])) / 1000);
      throw new ToolFailure(
        "rate_limited",
        "The package's own call budget for this minute is used up.",
        {
          retryAfterSec: wait,
        }
      );
    }
    calls.push(now);
  }

  async function once(path: string, query?: Query): Promise<Response> {
    const url = new URL(`${config.apiBase}${path}`);
    for (const [k, v] of Object.entries(query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v));
    try {
      return await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === "TimeoutError" || name === "AbortError")
        throw new ToolFailure("timeout", "No answer in time.");
      throw new ToolFailure(
        "unreachable",
        redact(String((err as Error).message ?? err), config.token)
      );
    }
  }

  async function fail(res: Response): Promise<never> {
    let code: string | undefined;
    let message = "";
    try {
      const body = (await res.json()) as { code?: unknown; error?: unknown; message?: unknown };
      if (typeof body.code === "string") code = body.code;
      const text = body.error ?? body.message;
      if (typeof text === "string") message = redact(text, config.token);
      else if (text && typeof (text as { message?: unknown }).message === "string") {
        message = redact((text as { message: string }).message, config.token);
      }
    } catch {
      /* a non-JSON error body: the status alone has to do */
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new ToolFailure(
      res.status >= 300 && res.status < 400 ? "server" : reasonForStatus(res.status, code),
      message,
      {
        status: res.status,
        code,
        retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      }
    );
  }

  return {
    async get<T>(path: string, query?: Query): Promise<T> {
      spendBudget();
      let res = await once(path, query);
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after"));
        if (Number.isFinite(wait) && wait > 0 && wait <= 5) {
          await sleep(wait * 1000);
          spendBudget();
          res = await once(path, query);
        }
      }
      if (!res.ok) return fail(res);
      try {
        return (await res.json()) as T;
      } catch {
        throw new ToolFailure("server", "The server answered with something that is not JSON.", {
          status: res.status,
        });
      }
    },
  };
}
