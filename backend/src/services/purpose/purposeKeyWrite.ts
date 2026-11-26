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

async function resolveData(
  data: Json,
  owners: () => Promise<string[]>,
  deps: PurposeKeyDeps
): Promise<Json> {
  const value = data.purpose;
  if (value === undefined) return data;
  if (value === null) return data.purposeKey === undefined ? { ...data, purposeKey: null } : data;
  const parsed = parsePurposeKey(value);
  if (!parsed) return refuse();
  if (parsed.type === "legacy") return data;
  if (parsed.type === "builtin") return { ...data, purpose: parsed.kind, purposeKey: parsed.key };
  const custom = await deps.customOf(parsed.id);
  if (!custom) return refuse();
  const who = await owners();
  if (who.length === 0 || who.some((u) => u !== custom.userId)) return refuse();
  return { ...data, purpose: custom.kind as Purpose, purposeKey: parsed.key };
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
