import type { DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import type { FactRecord } from "../factValues";

/**
 * The six shareable entry types (design 2026-10-09). The names are the
 * `ShareNotice.entityType` vocabulary the inbox reads.
 */
export const SHARE_ENTITIES = [
  "flight",
  "lodgingStay",
  "cruise",
  "rail",
  "rental",
  "stop",
] as const;
export type ShareEntity = (typeof SHARE_ENTITIES)[number];

/**
 * One entry as propagation sees it: who owns it, where it is filed, its key,
 * and its facts — the whitelist columns of `../facts` plus, for the nested
 * types, pseudo-fields standing for what hangs off the row (a stay's house, a
 * cruise's port calls and legs, the entry a stop wraps). Values are raw, as
 * Prisma returned them.
 */
export interface SharedRow {
  id: string;
  userId: string;
  tripId: string | null;
  shareKey: string | null;
  facts: FactRecord;
  /** What the inbox calls the entry: "TP571 FRA → LIS", "Hotel Avenida Palace". */
  label: string;
  /**
   * The zones the entry's time facts are read in, by fact name — what lets
   * the inbox show a changed departure on the place's clock (ADR 0002).
   */
  zones: Record<string, string | null>;
  /**
   * Never keyed on its own: a roadtrip station or route correction (S1
   * copies no roadtrip). Already keyed, it is still kept in step.
   */
  excluded?: boolean;
}

/**
 * Everything propagation needs to know about one type. Each adapter writes
 * only facts (`../facts`) and names `userId` on every row it creates.
 */
export interface EntityAdapter {
  entity: ShareEntity;
  /** The facts compared and carried, pseudo-fields included. */
  fields: readonly string[];
  load(c: DbTransaction, ids: readonly string[]): Promise<SharedRow[]>;
  /**
   * The rows holding `shareKey` on a trip of `groupId` — never by key alone:
   * a key that leaked or collided must not reach a row outside the group.
   */
  copiesOf(c: DbTransaction, shareKey: string, groupId: string): Promise<SharedRow[]>;
  setKey(c: DbTransaction, id: string, key: string | null): Promise<void>;
  /** A new copy of `source` in the recipient's trip; returns its id. */
  createCopy(
    c: DbTransaction,
    source: SharedRow,
    recipientId: string,
    recipientTripId: string
  ): Promise<string>;
  /** Write `values[key]` for every key onto `copy` (the recipient's row). */
  apply(
    c: DbTransaction,
    copy: SharedRow,
    values: FactRecord,
    keys: readonly string[]
  ): Promise<void>;
  remove(c: DbTransaction, id: string): Promise<void>;
}

/**
 * Facts → Prisma write data for the plain columns among `keys`. A JSON column
 * set to null is written as SQL NULL (`Prisma.DbNull`), as `jsonForWrite` does.
 */
export function plainData(
  values: FactRecord,
  keys: readonly string[],
  plain: readonly string[],
  json: readonly string[] = []
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    if (!plain.includes(key)) continue;
    data[key] = json.includes(key) && values[key] === null ? Prisma.DbNull : values[key];
  }
  return data;
}

export const joinLabel = (...parts: (string | null | undefined)[]): string =>
  parts
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .join(" ")
    .trim();
