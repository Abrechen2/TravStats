/**
 * Recursively convert BigInt values to strings for JSON serialization
 * Prisma returns BigInt values for certain fields (like id, size) which
 * cannot be directly serialized by JSON.stringify.
 *
 * Non-plain objects (Date, Buffer, Map, Set, RegExp, …) are returned
 * unchanged. Previously, Date instances fell through into the
 * `typeof === 'object'` branch where `Object.entries(date)` returns `[]`,
 * which silently destroyed every date field into an empty `{}` — breaking
 * date formatting in the UI (shown as "Unbekannt").
 */
export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return String(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt) as unknown as T;
  }

  // Preserve Date and other non-plain objects unchanged. Express's res.json
  // will call Date.prototype.toJSON for wire serialization.
  if (typeof obj === 'object') {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return obj;
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result as T;
  }

  return obj;
}
