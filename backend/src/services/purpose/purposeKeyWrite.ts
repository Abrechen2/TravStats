import type { Purpose } from "../../shared/purpose";
import { parsePurposeKey } from "../../shared/purposeCatalogue";
import { PURPOSE_MODELS } from "./tripInheritance";

/**
 * Every write of a purpose passes here (the Prisma hook in `db.ts`), so a form, an import, the
 * Companion and a bulk action agree on one rule:
 *
 * - `purpose: "builtin:<key>" | "custom:<uuid>"` is split into the KIND (`purpose`, which every
 *   filter and count reads) and the detail (`purposeKey`).
 * - `purpose: "private" | "business"` (every older client) sets the kind and leaves the stored
 *   detail as it is. A detail whose kind no longer matches is read as stale
 *   (`effectivePurposeKey`), so an old app re-sending the same kind keeps "Messe & Konferenz".
 * - `purpose: null` clears both.
 * - A custom key must belong to the owner of every row written; anything else is refused with
 *   `PURPOSE_UNKNOWN`, never stored.
 * - `purposeKey` written directly is held to the same rule and sets its kind; a key beside a
 *   contradicting `purpose`, or beside `purpose: null`, is refused.
 */

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface PurposeKeyDeps {
  /** The owner and kind of a custom purpose, or null when it does not exist. */
  customOf(id: string): Promise<{ userId: string; kind: string } | null>;
  /** The owners of the rows `where` selects in `model` (an update without `userId` in its where). */
  ownersOf(model: string, where: unknown): Promise<string[]>;
}

async function refuse(): Promise<never> {
  // Lazy: errorHandler pulls in modules that import `db.ts`, which imports this file.
  const { AppError } = await import("../../middleware/errorHandler");
  throw new AppError("Unknown purpose", 400, "PURPOSE_UNKNOWN", "purpose");
}

function ownerFromData(data: Json): string | null {
  if (typeof data.userId === "string") return data.userId;
  const user = data.user;
  if (isObject(user) && isObject(user.connect) && typeof user.connect.id === "string") {
    return user.connect.id;
  }
  return null;
}

/** `{ set: v }` is Prisma's long form of a scalar write; both mean v. */
const scalar = (v: unknown): unknown => (isObject(v) && "set" in v ? v.set : v);

/** A purpose value (legacy kind or key) as kind + detail, or a refusal. */
async function resolveValue(
  value: unknown,
  owners: () => Promise<string[]>,
  deps: PurposeKeyDeps
): Promise<{ purpose: Purpose; purposeKey?: string }> {
  const parsed = parsePurposeKey(value);
  if (!parsed) return refuse();
  if (parsed.type === "legacy") return { purpose: parsed.kind };
  if (parsed.type === "builtin") return { purpose: parsed.kind, purposeKey: parsed.key };
  const custom = await deps.customOf(parsed.id);
  if (!custom) return refuse();
  const who = await owners();
  if (who.length === 0 || who.some((u) => u !== custom.userId)) return refuse();
  return { purpose: custom.kind as Purpose, purposeKey: parsed.key };
}

async function resolveData(
  data: Json,
  owners: () => Promise<string[]>,
  deps: PurposeKeyDeps
): Promise<Json> {
  const value = scalar(data.purpose);
  const key = scalar(data.purposeKey);
  // A detail written directly (an import, a script, a future route) passes the same check as one
  // written through `purpose`: it must name a built-in or the owner's own purpose, it brings its
  // kind along, and it may not contradict a kind or key written beside it.
  if (key !== undefined && key !== null) {
    if (value === null) return refuse();
    const fromKey = await resolveValue(key, owners, deps);
    if (fromKey.purposeKey === undefined) return refuse();
    if (value !== undefined) {
      const fromValue = await resolveValue(value, owners, deps);
      const agrees =
        fromValue.purpose === fromKey.purpose &&
        (fromValue.purposeKey === undefined || fromValue.purposeKey === fromKey.purposeKey);
      if (!agrees) return refuse();
    }
    return { ...data, purpose: fromKey.purpose, purposeKey: fromKey.purposeKey };
  }
  if (value === undefined) return data;
  if (value === null) return { ...data, purposeKey: null };
  const resolved = await resolveValue(value, owners, deps);
  return resolved.purposeKey === undefined
    ? { ...data, purpose: resolved.purpose }
    : { ...data, ...resolved };
}

export async function resolvePurposeKeysOnWrite<A>(
  model: string | undefined,
  operation: string,
  args: A,
  deps: PurposeKeyDeps
): Promise<A> {
  if (!model || !PURPOSE_MODELS.has(model) || !isObject(args)) return args;
  const a = args as Json;
  const whereOwners = async (): Promise<string[]> => {
    const where = a.where;
    if (isObject(where) && typeof where.userId === "string") return [where.userId];
    return await deps.ownersOf(model, where);
  };
  switch (operation) {
    case "create": {
      if (!isObject(a.data)) return args;
      const data = a.data;
      const owner = ownerFromData(data);
      return { ...a, data: await resolveData(data, async () => (owner ? [owner] : []), deps) } as A;
    }
    case "createMany":
    case "createManyAndReturn": {
      const rows = Array.isArray(a.data) ? a.data : [a.data];
      const out: unknown[] = [];
      for (const row of rows) {
        if (!isObject(row)) {
          out.push(row);
          continue;
        }
        const owner = ownerFromData(row);
        out.push(await resolveData(row, async () => (owner ? [owner] : []), deps));
      }
      return { ...a, data: Array.isArray(a.data) ? out : out[0] } as A;
    }
    case "update":
    case "updateMany":
    case "updateManyAndReturn": {
      if (!isObject(a.data)) return args;
      return { ...a, data: await resolveData(a.data, whereOwners, deps) } as A;
    }
    case "upsert": {
      const create = isObject(a.create) ? a.create : null;
      const update = isObject(a.update) ? a.update : null;
      const createOwner = create ? ownerFromData(create) : null;
      return {
        ...a,
        ...(create && {
          create: await resolveData(create, async () => (createOwner ? [createOwner] : []), deps),
        }),
        ...(update && {
          update: await resolveData(
            update,
            async () => {
              const found = await whereOwners();
              return found.length === 0 && createOwner ? [createOwner] : found;
            },
            deps
          ),
        }),
      } as A;
    }
    default:
      return args;
  }
}

/**
 * The custom purpose key a write stores, if any (`custom:<uuid>`). The hook uses it to settle a
 * race with a concurrent delete or re-kind of that purpose (`reconcileCustomPurposeKey`).
 */
export function writtenCustomKey(operation: string, args: unknown): string | null {
  if (!isObject(args)) return null;
  const bodies: unknown[] =
    operation === "upsert"
      ? [args.create, args.update]
      : Array.isArray(args.data)
        ? args.data
        : [args.data];
  for (const body of bodies) {
    if (!isObject(body)) continue;
    const key = scalar(body.purposeKey);
    if (typeof key === "string" && key.startsWith("custom:")) return key;
  }
  return null;
}
