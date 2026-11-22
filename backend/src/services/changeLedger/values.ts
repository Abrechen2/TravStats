import { Prisma } from "../../prisma";

/**
 * How a value is kept in the ledger: as JSON text, capped.
 *
 * The ledger keeps scalars and short JSON, never a blob or a payload dump. A
 * value that would not fit (a long note, a geometry that slipped past the
 * ignore list, bytes) is recorded as `omitted`: the row still says the field
 * changed, and offers no restore.
 */
export const MAX_VALUE_CHARS = 1000;

export interface EncodedValue {
  value: string | null;
  omitted: boolean;
}

const isNullSentinel = (v: unknown): boolean =>
  v === Prisma.DbNull || v === Prisma.JsonNull || v === Prisma.AnyNull;

/** The value as it is stored in the ledger. */
export function encodeValue(raw: unknown): EncodedValue {
  if (raw === null || raw === undefined || isNullSentinel(raw))
    return { value: null, omitted: false };
  if (raw instanceof Uint8Array) return { value: null, omitted: true };
  let plain: unknown = raw;
  if (raw instanceof Date) plain = Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  else if (Prisma.Decimal.isDecimal(raw)) plain = (raw as Prisma.Decimal).toString();
  else if (typeof raw === "bigint") plain = raw.toString();
  const text = JSON.stringify(plain);
  if (text === undefined) return { value: null, omitted: true };
  if (text.length > MAX_VALUE_CHARS) return { value: null, omitted: true };
  return { value: text, omitted: false };
}

/** Sentinel: the new value cannot be told from the write alone. */
export const UNKNOWN = Symbol("unknown");

const ARITHMETIC = new Set(["increment", "decrement", "multiply", "divide"]);
const OPERATORS = new Set([...ARITHMETIC, "set", "push", "unset"]);

function operatorOf(value: unknown): [string, unknown] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (value instanceof Date || Prisma.Decimal.isDecimal(value) || isNullSentinel(value))
    return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || !OPERATORS.has(keys[0])) return null;
  return [keys[0], (value as Record<string, unknown>)[keys[0]]];
}

/** A written value in the type the database hands back, so equal values compare equal. */
function coerce(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return value;
  if (type === "DateTime" && (typeof value === "string" || typeof value === "number")) {
    return new Date(value);
  }
  if (type === "Decimal" && !Prisma.Decimal.isDecimal(value)) {
    try {
      return new Prisma.Decimal(value as string | number);
    } catch {
      return UNKNOWN;
    }
  }
  if (type === "BigInt" && typeof value !== "bigint") {
    try {
      return BigInt(value as string | number);
    } catch {
      return UNKNOWN;
    }
  }
  return value;
}

/**
 * The value a field holds after `written` was applied to `old`. `UNKNOWN` when
 * that cannot be worked out without asking the database (an increment of a
 * null, an operator this file does not know).
 */
export function appliedValue(
  written: unknown,
  old: unknown,
  type: string,
  isList: boolean
): unknown {
  if (type === "Json") return written;
  const op = operatorOf(written);
  if (!op) return coerce(written, type);
  const [name, arg] = op;
  if (name === "set") return coerce(arg, type);
  if (name === "unset") return null;
  if (name === "push") {
    if (!isList) return UNKNOWN;
    const base = Array.isArray(old) ? old : [];
    return [...base, ...(Array.isArray(arg) ? arg : [arg])];
  }
  if (typeof old !== "number" || typeof arg !== "number") return UNKNOWN;
  if (name === "increment") return old + arg;
  if (name === "decrement") return old - arg;
  if (name === "multiply") return old * arg;
  return arg === 0 ? UNKNOWN : old / arg;
}

/**
 * The stored text back as a value to write, for a restore. Dates come back as
 * Date; everything else is the JSON value it was.
 */
export function decodeValue(text: string | null, type: string): unknown {
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  if (parsed === null) return null;
  if (type === "DateTime" && typeof parsed === "string") return new Date(parsed);
  if (type === "Decimal" && typeof parsed === "string") return new Prisma.Decimal(parsed);
  if (type === "BigInt" && typeof parsed === "string") return BigInt(parsed);
  return parsed;
}
