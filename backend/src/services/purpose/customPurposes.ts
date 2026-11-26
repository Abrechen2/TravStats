import { prisma } from "../../db";
import { runUnfiltered } from "../provenance/recordedOnly";
import { BUILTIN_PURPOSES, BUILTIN_PREFIX, CUSTOM_PREFIX } from "../../shared/purposeCatalogue";
import type { Purpose } from "../../shared/purpose";

/**
 * A user's own purposes (spec 2026-11-22-private-business-purpose.md, "Custom purposes"). Private
 * to the owner: nothing here is read by sharing, federation or the leaderboard, and an entry only
 * carries the reference `custom:<id>` beside its kind.
 */

/** The Prisma delegates of the purpose models. */
const DELEGATES = [
  "flight",
  "lodgingStay",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "rentalBooking",
  "cruise",
  "placeVisit",
  "tripRoute",
] as const;

type Delegate = {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: { purpose: string };
  }): Promise<{ count: number }>;
};
const delegate = (c: unknown, name: string): Delegate => (c as Record<string, Delegate>)[name];

export interface CustomPurposeView {
  key: string;
  id: string;
  name: string;
  nameEn: string | null;
  kind: Purpose;
  color: string;
  icon: string;
  archived: boolean;
  /** How many of the owner's entries use it; deleting is only possible at 0. */
  usage: number;
}

type Row = {
  id: string;
  name: string;
  nameEn: string | null;
  kind: string;
  color: string;
  icon: string;
  archivedAt: Date | null;
};

/** How many of the user's entries carry the key (every entry, hidden ones included). */
export async function countPurposeUsage(userId: string, key: string): Promise<number> {
  const counts = await runUnfiltered(() =>
    Promise.all(
      DELEGATES.map((n) => delegate(prisma, n).count({ where: { userId, purposeKey: key } }))
    )
  );
  return counts.reduce((a, b) => a + b, 0);
}

const view = (row: Row, usage: number): CustomPurposeView => ({
  key: `${CUSTOM_PREFIX}${row.id}`,
  id: row.id,
  name: row.name,
  nameEn: row.nameEn,
  kind: row.kind as Purpose,
  color: row.color,
  icon: row.icon,
  archived: row.archivedAt !== null,
  usage,
});

export async function listCustomPurposes(userId: string): Promise<CustomPurposeView[]> {
  const rows = await prisma.customPurpose.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return Promise.all(
    rows.map(async (r) => view(r, await countPurposeUsage(userId, `${CUSTOM_PREFIX}${r.id}`)))
  );
}

/** The whole catalogue a picker needs: the built-ins with both labels, then the user's own. */
export async function purposeCatalogue(userId: string) {
  return {
    builtins: BUILTIN_PURPOSES.map((p) => ({
      key: `${BUILTIN_PREFIX}${p.key}`,
      kind: p.kind as Purpose,
      icon: p.icon as string,
      color: p.color as string,
      label: { de: p.de as string, en: p.en as string },
    })),
    custom: await listCustomPurposes(userId),
  };
}

export async function createCustomPurpose(
  userId: string,
  input: { name: string; nameEn?: string | null; kind: Purpose; color: string; icon: string }
): Promise<CustomPurposeView> {
  const row = await prisma.customPurpose.create({
    data: { userId, ...input, nameEn: input.nameEn || null },
  });
  return view(row, 0);
}

/**
 * Renames, recolours, archives or re-kinds one of the user's purposes. A changed kind is carried
 * onto every entry that uses it, in the same transaction, so the business filter and the counts
 * follow at once. Undefined: not the user's.
 */
export async function updateCustomPurpose(
  userId: string,
  id: string,
  input: {
    name?: string;
    nameEn?: string | null;
    kind?: Purpose;
    color?: string;
    icon?: string;
    archived?: boolean;
  }
): Promise<CustomPurposeView | undefined> {
  const key = `${CUSTOM_PREFIX}${id}`;
  const { archived, ...fields } = input;
  const row = await runUnfiltered(() =>
    prisma.$transaction(async (tx) => {
      // Read and lock inside the transaction: two concurrent re-kinds must not both compare
      // against the same old kind and skip the propagation.
      await tx.$queryRaw`SELECT id FROM custom_purposes WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.customPurpose.findFirst({ where: { id, userId } });
      if (!existing) return null;
      const updated = await tx.customPurpose.update({
        where: { id },
        data: {
          ...fields,
          ...(fields.nameEn !== undefined && { nameEn: fields.nameEn || null }),
          ...(archived !== undefined && {
            archivedAt: archived ? (existing.archivedAt ?? new Date()) : null,
          }),
        },
      });
      if (fields.kind && fields.kind !== existing.kind) {
        for (const name of DELEGATES) {
          // Purpose is the member's own view, never a share fact: nothing to propagate.
          await delegate(tx, name).updateMany({
            where: { userId, purposeKey: key },
            data: { purpose: fields.kind },
          });
        }
      }
      return updated;
    })
  );
  if (!row) return undefined;
  return view(row, await countPurposeUsage(userId, key));
}

/**
 * Deletes one of the user's purposes, only while no entry uses it ("in-use": archive it instead).
 */
export async function deleteCustomPurpose(
  userId: string,
  id: string
): Promise<"deleted" | "in-use" | "not-found"> {
  return runUnfiltered(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM custom_purposes WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.customPurpose.findFirst({ where: { id, userId } });
      if (!existing) return "not-found" as const;
      const key = `${CUSTOM_PREFIX}${id}`;
      const counts = await Promise.all(
        DELEGATES.map((n) => delegate(tx, n).count({ where: { userId, purposeKey: key } }))
      );
      if (counts.some((c) => c > 0)) return "in-use" as const;
      await tx.customPurpose.delete({ where: { id } });
      return "deleted" as const;
    })
  );
}
