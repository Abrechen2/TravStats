import type { Config } from "./config";
import { ToolFailure, reasonForStatus } from "./errors";
import { redact } from "./redact";

export type Query = Record<string, string | number | boolean | undefined>;

/** A file part of a multipart request. */
export interface FormFile {
  field: string;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface WriteOptions {
  /** The tool that makes the call; sent as `X-TravStats-Tool` so the server's log can say which tool wrote. */
  tool?: string;
}

export interface ApiClient {
  get<T = unknown>(path: string, query?: Query): Promise<T>;
  post<T = unknown>(
    path: string,
    body: unknown,
    options?: WriteOptions & { query?: Query }
  ): Promise<T>;
  postForm<T = unknown>(
    path: string,
    file: FormFile,
    fields: Record<string, string | undefined>,
    options?: WriteOptions
  ): Promise<T>;
}

type FetchLike = typeof fetch;

export const CLIENT_NAME = "travstats-mcp";

/** Plain REST client: bearer token, no redirects, a per-minute client budget and one polite 429 retry. */
export function createClient(
  config: Pick<Config, "apiBase" | "token" | "clientBudgetPerMinute" | "timeoutMs">,
  fetchImpl: FetchLike = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  clientVersion = "0.0.0"
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

  interface Call {
    method: "GET" | "POST";
    path: string;
    query?: Query;
    json?: unknown;
    form?: () => FormData;
    tool?: string;
  }

  async function once(call: Call): Promise<Response> {
    const url = new URL(`${config.apiBase}${call.path}`);
    for (const [k, v] of Object.entries(call.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      "X-TravStats-Client": `${CLIENT_NAME}/${clientVersion}`,
    };
    if (call.tool) headers["X-TravStats-Tool"] = call.tool;
    let body: BodyInit | undefined;
    if (call.form) body = call.form();
    else if (call.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(call.json);
    }
    try {
      return await fetchImpl(url, {
        method: call.method,
        redirect: "manual",
        headers,
        ...(body !== undefined ? { body } : {}),
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

  async function run<T>(call: Call): Promise<T> {
    spendBudget();
    let res = await once(call);
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after"));
      if (Number.isFinite(wait) && wait > 0 && wait <= 5) {
        await sleep(wait * 1000);
        spendBudget();
        res = await once(call);
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
  }

  return {
    get: <T>(path: string, query?: Query) => run<T>({ method: "GET", path, query }),
    post: <T>(path: string, body: unknown, options: WriteOptions & { query?: Query } = {}) =>
      run<T>({ method: "POST", path, json: body, query: options.query, tool: options.tool }),
    postForm: <T>(
      path: string,
      file: FormFile,
      fields: Record<string, string | undefined>,
      options: WriteOptions = {}
    ) =>
      run<T>({
        method: "POST",
        path,
        tool: options.tool,
        form: () => {
          const form = new FormData();
          for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.set(k, v);
          form.set(
            file.field,
            new Blob([file.bytes as BlobPart], { type: file.mimeType }),
            file.fileName
          );
          return form;
        },
      }),
  };
}
