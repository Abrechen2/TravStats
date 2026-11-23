import { readFileSync } from "node:fs";
import { ToolFailure } from "./errors";

export interface Config {
  /** API root, e.g. https://trav.example.org/api/v1 — chosen by the user, never by a tool argument. */
  apiBase: string;
  instance: string;
  token: string;
  clientBudgetPerMinute: number;
  timeoutMs: number;
}

const TOKEN_SHAPE = /^ts_pat_[0-9a-zA-Z]{16,}$/;

/** Loopback, RFC 1918, link-local and `.local` names: plain http inside the home network is normal for a self-hosted server. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1" || h.endsWith(".local") || h.endsWith(".localhost"))
    return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || h.startsWith("fe80:")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const rawUrl = env.TRAVSTATS_URL?.trim();
  if (!rawUrl) throw new ToolFailure("config", "TRAVSTATS_URL is not set.");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ToolFailure("config", "TRAVSTATS_URL is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ToolFailure("config", "TRAVSTATS_URL must be http(s).");
  }
  if (
    url.protocol === "http:" &&
    !isPrivateHost(url.hostname) &&
    env.TRAVSTATS_ALLOW_INSECURE_HTTP !== "1"
  ) {
    throw new ToolFailure(
      "config",
      "TRAVSTATS_URL is plain http on a public address; the token would travel unencrypted. Use https, or set TRAVSTATS_ALLOW_INSECURE_HTTP=1 if you accept that."
    );
  }
  let token = env.TRAVSTATS_TOKEN?.trim();
  if (!token && env.TRAVSTATS_TOKEN_FILE) {
    try {
      token = readFileSync(env.TRAVSTATS_TOKEN_FILE, "utf8").trim();
    } catch {
      throw new ToolFailure("config", "TRAVSTATS_TOKEN_FILE could not be read.");
    }
  }
  if (!token)
    throw new ToolFailure("config", "TRAVSTATS_TOKEN (or TRAVSTATS_TOKEN_FILE) is not set.");
  if (!TOKEN_SHAPE.test(token))
    throw new ToolFailure("config", "The token does not look like a TravStats token (ts_pat_…).");
  const instance = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  const budget = Number(env.TRAVSTATS_MCP_CALLS_PER_MINUTE ?? 60);
  return {
    apiBase: `${instance}/api/v1`,
    instance,
    token,
    clientBudgetPerMinute: Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 60,
    timeoutMs: 20_000,
  };
}
