import { Prisma } from "../../../prisma";

/**
 * The shared half of every facts module: copy exactly the named columns of a
 * row, nothing else. A whitelist rather than "everything but the private
 * fields", so a column added to a model later stays PRIVATE until someone
 * decides it is a fact — the failure that way round is a field that does not
 * sync, never a seat number or a price leaking into another account.
 *
 * Values are copied as stored (ADR 0002): a wall clock and its zone travel
 * together and nothing is re-derived on the way.
 */
export function pickFacts<T extends object, K extends keyof T>(
  row: T,
  fields: readonly K[]
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const field of fields) out[field] = row[field];
  return out;
}

/**
 * A JSON column read back (`JsonValue | null`) as a value Prisma accepts for a
 * write. SQL NULL stays SQL NULL — `Prisma.DbNull` — rather than turning into
 * a JSON `null` literal that every `IS NULL` reader would miss.
 */
export function jsonForWrite(
  value: Prisma.JsonValue | null
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonValue);
}
