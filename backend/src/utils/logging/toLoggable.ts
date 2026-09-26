/**
 * Turn any value into something `JSON.stringify` cannot choke on.
 *
 * The database query log used to clone arguments with
 * `JSON.parse(JSON.stringify(args))`, which THROWS on a BigInt. A passkey's
 * signature counter is a BigInt, so with "log database queries" on, creating a
 * user answered 500 and created nobody (audit 2026-09-26): the log line broke
 * the request it was describing. This walk never throws — BigInt becomes a
 * string, Prisma's Decimal and Date their JSON form, a Buffer its length, a
 * cycle a marker — and it redacts credential-shaped keys on the way.
 */

const MAX_DEPTH = 8;
const MAX_ARRAY = 50;

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "password_hash",
  "token",
  "tokenHash",
  "secret",
  "apiKey",
  "api_key",
  "publicKey",
  "openaiApiKey",
  "claudeApiKey",
  "globalOpenaiApiKey",
  "globalClaudeApiKey",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || /(ApiKey|Secret|Password|Token)$/.test(key);
}

export function toLoggable(value: unknown): unknown {
  return walk(value, 0, new WeakSet<object>());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
      return `[${typeof value}]`;
    case "object":
      break;
    default:
      return value;
  }

  const obj = value as object;
  if (obj instanceof Date)
    return Number.isNaN(obj.getTime()) ? "[Invalid Date]" : obj.toISOString();
  if (Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
    return `[${obj.constructor.name} ${obj.byteLength} bytes]`;
  }
  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";

  // Prisma's Decimal and anything else that knows its JSON form.
  const toJSON = (obj as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function" && !Array.isArray(obj)) {
    try {
      return walk(toJSON.call(obj), depth + 1, seen);
    } catch {
      return "[Unserializable]";
    }
  }

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const head = obj.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1, seen));
      return obj.length > MAX_ARRAY ? [...head, `[+${obj.length - MAX_ARRAY} more]`] : head;
    }
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(obj)) {
      out[key] = isSensitiveKey(key) ? "[REDACTED]" : walk(inner, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}
