import net from "net";

/**
 * Where a language-model endpoint lives — ONE rule for "may it be plain http"
 * and "does sending a document there leave the local network".
 *
 * The two questions have the same answer on purpose. A host on the operator's
 * own network (loopback, RFC 1918, IPv6 ULA/link-local, a `.local`/`.lan`/
 * `.home.arpa`/`.internal` name, or a single-label name the LAN resolver owns)
 * is where Ollama has always lived here, over plain http, and nothing about a
 * document sent there leaves the house. Every other host is somebody else's
 * computer: it must be https, because the request carries an API key and a
 * booking mail, and it needs the admin's explicit cloud opt-in
 * (`llmCloudOptIn`, enforced in `llmGate.ts`).
 *
 * The classification reads the NAME, not a DNS answer: a public name that
 * happens to resolve into the LAN is still treated as cloud. That errs toward
 * asking for consent, which is the safe direction.
 *
 * There is deliberately no block on private addresses (unlike an SSRF filter):
 * the admin sets this URL, and a LAN model server is the primary use case —
 * the same reasoning as `normalizeImmichBaseUrl`.
 */

const LOCAL_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".localhost"];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isPrivateIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "::1") return true;
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return /^f[cd][0-9a-f]{0,2}:/.test(lower) || /^fe[89ab][0-9a-f]?:/.test(lower);
}

/** Whether a hostname (as `URL.hostname` gives it) is on the local network. */
export function isLocalLlmHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost") return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isPrivateIpv6(host);
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // A single-label name ("ollama", "nas") only resolves through the LAN's own
  // resolver — no public DNS answers it.
  return !host.includes(".");
}

/** Stable codes, so the admin UI words the rejection in its own language. */
export type LlmEndpointProblem =
  "invalid_url" | "unsupported_protocol" | "credentials_in_url" | "https_required";

export type LlmEndpointCheck =
  { ok: true; url: string; isLocal: boolean } | { ok: false; problem: LlmEndpointProblem };

/**
 * Validate and normalise a base URL an admin typed for a model endpoint.
 * The normalised form has no trailing slash, so `${url}/chat/completions`
 * never doubles one.
 */
export function checkLlmBaseUrl(raw: string): LlmEndpointCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, problem: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, problem: "unsupported_protocol" };
  }
  // A key belongs in the key field (encrypted, masked), never in a URL that
  // is stored in plain text and shown back.
  if (parsed.username || parsed.password) return { ok: false, problem: "credentials_in_url" };
  const isLocal = isLocalLlmHost(parsed.hostname);
  if (parsed.protocol === "http:" && !isLocal) return { ok: false, problem: "https_required" };
  const path = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.protocol}//${parsed.host}${path}`, isLocal };
}

/** The host part only — what a parse result or a log line may name. */
export function llmHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
