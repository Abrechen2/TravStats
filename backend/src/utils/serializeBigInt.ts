/**
 * Recursively convert BigInt values to strings for JSON serialization
 * Prisma returns BigInt values for certain fields (like id, size) which
 * cannot be directly serialized by JSON.stringify
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

  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInt(value);
    }
    return result as T;
  }

  return obj;
}









