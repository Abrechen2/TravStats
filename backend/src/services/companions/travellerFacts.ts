import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { canonicalizeCompanionName } from "../../utils/companionName";
import { ensureStayCompanions } from "./stayCompanions";
import { assertEntryOwnedIn, type EntryRef } from "../documents/documentLinks";

/**
 * Per-traveller facts on an entry — phase D7 of
 * docs/superpowers/specs/2026-11-21-document-links.md: the seat, class, ticket
 * number, booking reference and loyalty number of ONE companion, as columns on
 * the companion link tables (a cabin on a cruise, a driver flag on a rental).
 * The owner's own values stay on the entry. Null = not recorded, never "".
 *
 * Who is ON the entry is unchanged: the link table (a lodging stay names its
 * people as text, `LodgingStay.companions`, and its link table only holds facts).
 */

export const TRAVELLER_ENTRY_TYPES = [
  "flight",
  "cruise",
  "lodgingStay",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "rentalBooking",
] as const;
export type TravellerEntryType = (typeof TRAVELLER_ENTRY_TYPES)[number];

const SEATED = ["seatNumber", "seatClass", "ticketNumber", "bookingReference", "loyaltyNumber"];

interface Spec {
  delegate:
    | "flightCompanion"
    | "cruiseCompanion"
    | "lodgingStayCompanion"
    | "railJourneyCompanion"
    | "busJourneyCompanion"
    | "ferryJourneyCompanion"
    | "rentalBookingCompanion";
  entryColumn: string;
  /** Text facts, in display order. */
  text: readonly string[];
  /** Boolean facts. */
  flags: readonly string[];
}

export const TRAVELLER_SPECS: Record<TravellerEntryType, Spec> = {
  flight: { delegate: "flightCompanion", entryColumn: "flightId", text: SEATED, flags: [] },
  railJourney: {
    delegate: "railJourneyCompanion",
    entryColumn: "railJourneyId",
    text: SEATED,
    flags: [],
  },
  busJourney: {
    delegate: "busJourneyCompanion",
    entryColumn: "busJourneyId",
    text: SEATED,
    flags: [],
  },
  ferryJourney: {
    delegate: "ferryJourneyCompanion",
    entryColumn: "ferryJourneyId",
    text: SEATED,
    flags: [],
  },
  cruise: {
    delegate: "cruiseCompanion",
    entryColumn: "cruiseId",
    text: ["cabin", "bookingReference", "loyaltyNumber"],
    flags: [],
  },
  rentalBooking: {
    delegate: "rentalBookingCompanion",
    entryColumn: "rentalBookingId",
    text: ["bookingReference", "loyaltyNumber"],
    flags: ["isDriver"],
  },
  lodgingStay: {
    delegate: "lodgingStayCompanion",
    entryColumn: "lodgingStayId",
    text: ["bookingReference", "loyaltyNumber"],
    flags: [],
  },
};

export type FactsSource = "user" | "auto";
export type TravellerFacts = Record<string, string | boolean | null>;

export function isTravellerEntry(type: string): type is TravellerEntryType {
  return (TRAVELLER_ENTRY_TYPES as readonly string[]).includes(type);
}

/** The fact columns a type carries, text and flags together. */
export function factFields(type: TravellerEntryType): string[] {
  return [...TRAVELLER_SPECS[type].text, ...TRAVELLER_SPECS[type].flags];
}

/** One delegate shape for every link table; their generated types share nothing. */
interface LinkDelegate {
  findMany(args: object): Promise<Array<Record<string, unknown>>>;
  findFirst(args: object): Promise<Record<string, unknown> | null>;
  create(args: object): Promise<unknown>;
  createMany(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
  updateMany(args: object): Promise<unknown>;
  deleteMany(args: object): Promise<unknown>;
  upsert(args: object): Promise<unknown>;
}

function delegateOf(db: DbTransaction | typeof prisma, type: TravellerEntryType): LinkDelegate {
  return db[TRAVELLER_SPECS[type].delegate] as unknown as LinkDelegate;
}

/**
 * Makes an entry's companion link rows exactly `companionIds`, in that order,
 * WITHOUT touching the facts of a person who stays. The edit routes used to
 * `deleteMany` + `createMany` the rows, which would drop every seat and ticket
 * number the moment an unrelated edit re-sent the companions.
 */
export async function syncCompanionLinks(
  db: DbTransaction,
  type: Exclude<TravellerEntryType, "lodgingStay">,
  entryId: string,
  companionIds: readonly string[]
): Promise<void> {
  const delegate = delegateOf(db, type);
  const column = TRAVELLER_SPECS[type].entryColumn;
  // One read, then writes only for what differs: a bulk edit re-syncs hundreds of
  // entries, and a per-person update/create here cost seven queries per flight.
  const have = new Map(
    (
      await delegate.findMany({
        where: { [column]: entryId },
        select: { companionId: true, position: true },
      })
    ).map((r) => [r.companionId as string, r.position as number])
  );
  const wanted = new Set(companionIds);
  const stale = [...have.keys()].filter((id) => !wanted.has(id));
  if (stale.length > 0) {
    await delegate.deleteMany({ where: { [column]: entryId, companionId: { in: stale } } });
  }
  const created: Array<Record<string, unknown>> = [];
  for (const [position, companionId] of companionIds.entries()) {
    if (!have.has(companionId)) {
      created.push({ [column]: entryId, companionId, position });
    } else if (have.get(companionId) !== position) {
      await delegate.updateMany({ where: { [column]: entryId, companionId }, data: { position } });
    }
  }
  if (created.length > 0) await delegate.createMany({ data: created, skipDuplicates: true });
}

export interface TravellerRow {
  companionId: string;
  displayName: string;
  position: number;
  facts: TravellerFacts;
  factsSource: FactsSource | null;
  /** The documents assigned to this person on this entry. */
  documents: Array<{ id: string; displayName: string; kind: string | null }>;
}

const STAY_WHO = { id: true, companions: true, userId: true } as const;

/** The companions on an entry, each with their facts and documents. */
export async function listTravellers(userId: string, entry: EntryRef): Promise<TravellerRow[]> {
  if (!isTravellerEntry(entry.type)) {
    throw new AppError("This entry type has no travellers", 400, "TRAVELLERS_UNSUPPORTED");
  }
  await assertEntryOwnedIn(prisma, userId, entry);
  const type = entry.type;
  const spec = TRAVELLER_SPECS[type];
  const delegate = delegateOf(prisma, type);
  const rows = await delegate.findMany({
    where: { [spec.entryColumn]: entry.id },
    include: { companion: { select: { id: true, displayName: true } } },
    orderBy: { position: "asc" },
  });

  let who = rows.map((r) => ({
    companionId: r.companionId as string,
    displayName: (r.companion as { displayName: string }).displayName,
    position: r.position as number,
    row: r as Record<string, unknown> | null,
  }));
  if (type === "lodgingStay") {
    const stay = await prisma.lodgingStay.findFirstOrThrow({
      where: { id: entry.id, userId },
      select: STAY_WHO,
    });
    // Text-only people (a stay saved by an importer, or before D7) get their row on first read.
    await ensureStayCompanions(prisma, userId, stay.companions);
    const catalogue = await prisma.companion.findMany({
      where: { userId },
      select: { id: true, displayName: true, canonicalName: true },
    });
    const byName = new Map(catalogue.map((c) => [c.canonicalName, c]));
    const factRows = new Map(rows.map((r) => [r.companionId as string, r]));
    who = stay.companions.flatMap((name, position) => {
      const c = byName.get(canonicalizeCompanionName(name));
      return c
        ? [
            {
              companionId: c.id,
              displayName: c.displayName,
              position,
              row: factRows.get(c.id) ?? null,
            },
          ]
        : [];
    });
  }

  const links = await prisma.documentLink.findMany({
    where: { [spec.entryColumn]: entry.id, companionId: { not: null } },
    select: {
      companionId: true,
      document: { select: { id: true, originalName: true, storedName: true, kind: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const fields = factFields(type);
  return who.map(({ companionId, displayName, position, row }) => ({
    companionId,
    displayName,
    position,
    facts: Object.fromEntries(
      fields.map((f) => [f, (row?.[f] as string | boolean | null) ?? null])
    ),
    factsSource: (row?.factsSource as FactsSource | null) ?? null,
    documents: links
      .filter((l) => l.companionId === companionId)
      .map((l) => ({
        id: l.document.id,
        displayName: l.document.originalName ?? l.document.storedName,
        kind: l.document.kind,
      })),
  }));
}

export type FactsPatch = Record<string, string | boolean | null | undefined>;

/** Clean a patch to the type's own fields: trimmed text, "" = cleared, anything else refused. */
export function cleanPatch(type: TravellerEntryType, patch: FactsPatch): FactsPatch {
  const spec = TRAVELLER_SPECS[type];
  const out: FactsPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (spec.text.includes(key)) {
      if (value !== null && typeof value !== "string") {
        throw new AppError(`${key} must be text`, 400, "TRAVELLER_FACT_INVALID");
      }
      const text = typeof value === "string" ? value.trim() : null;
      out[key] = text ? text.slice(0, 80) : null;
    } else if (spec.flags.includes(key)) {
      if (value !== null && typeof value !== "boolean") {
        throw new AppError(`${key} must be true or false`, 400, "TRAVELLER_FACT_INVALID");
      }
      out[key] = value;
    } else {
      throw new AppError(`${key} is not a fact of this entry`, 400, "TRAVELLER_FACT_INVALID");
    }
  }
  return out;
}

/**
 * Writes one companion's facts on one entry. The companion must be the
 * caller's own AND on the entry (404 otherwise): facts never put a person on
 * an entry.
 */
export async function setTravellerFacts(
  userId: string,
  entry: EntryRef,
  companionId: string,
  patch: FactsPatch,
  source: FactsSource = "user"
): Promise<TravellerRow> {
  if (!isTravellerEntry(entry.type)) {
    throw new AppError("This entry type has no travellers", 400, "TRAVELLERS_UNSUPPORTED");
  }
  const type = entry.type;
  const data = cleanPatch(type, patch);
  await prisma.$transaction(async (tx) => {
    await writeFactsInTx(tx, userId, { type, id: entry.id }, companionId, data, source);
  });
  const row = (await listTravellers(userId, entry)).find((r) => r.companionId === companionId);
  if (!row) throw new AppError("Traveller not found", 404, "TRAVELLER_NOT_FOUND");
  return row;
}

/** Whether the companion (the caller's) is on the entry, by the table or, for a stay, its names. */
async function isOnEntry(
  tx: DbTransaction,
  userId: string,
  type: TravellerEntryType,
  entryId: string,
  companionId: string
): Promise<boolean> {
  const companion = await tx.companion.findFirst({
    where: { id: companionId, userId },
    select: { canonicalName: true },
  });
  if (!companion) return false;
  if (type === "lodgingStay") {
    const stay = await tx.lodgingStay.findFirst({
      where: { id: entryId, userId },
      select: { companions: true },
    });
    return !!stay?.companions.some((n) => canonicalizeCompanionName(n) === companion.canonicalName);
  }
  const link = await delegateOf(tx, type).findFirst({
    where: { [TRAVELLER_SPECS[type].entryColumn]: entryId, companionId },
    select: { companionId: true },
  });
  return !!link;
}

/**
 * The write itself, inside the caller's transaction. `auto` writes only the
 * fields that are still empty and never replaces a `user` row's source: a
 * parse fills gaps, it does not overrule the person who typed the value.
 */
export async function writeFactsInTx(
  tx: DbTransaction,
  userId: string,
  entry: { type: TravellerEntryType; id: string },
  companionId: string,
  data: FactsPatch,
  source: FactsSource
): Promise<boolean> {
  if (!(await isOnEntry(tx, userId, entry.type, entry.id, companionId))) {
    throw new AppError("Traveller not found", 404, "TRAVELLER_NOT_FOUND");
  }
  const spec = TRAVELLER_SPECS[entry.type];
  const delegate = delegateOf(tx, entry.type);
  const where = { [spec.entryColumn]: entry.id, companionId };
  if (source === "user") {
    const existing = await delegate.findFirst({ where });
    if (existing) {
      await delegate.updateMany({ where, data: { ...data, factsSource: "user" } });
    } else {
      // Only a lodging stay has no row until a fact exists.
      await delegate.createMany({
        data: [{ ...where, ...data, factsSource: "user" }],
        skipDuplicates: true,
      });
      await delegate.updateMany({ where, data: { ...data, factsSource: "user" } });
    }
    return true;
  }
  // Automatic: each field is written only WHERE IT IS STILL EMPTY, in the
  // statement itself. Reading first and writing after let a manual save made in
  // between be overwritten; a conditional update cannot.
  if (!(await delegate.findFirst({ where }))) {
    await delegate.createMany({ data: [{ ...where }], skipDuplicates: true });
  }
  let wrote = false;
  for (const [field, value] of Object.entries(data)) {
    if (value == null) continue;
    const hit = (await delegate.updateMany({
      where: { ...where, [field]: null },
      data: { [field]: value },
    })) as {
      count: number;
    };
    if (hit.count > 0) wrote = true;
  }
  // The source follows only a row nobody has claimed (`user` stays `user`).
  if (wrote)
    await delegate.updateMany({
      where: { ...where, factsSource: null },
      data: { factsSource: "auto" },
    });
  return wrote;
}

/** Drops a stay's fact rows for people the stay no longer names (the editor changed its list). */
export async function pruneStayFacts(
  tx: DbTransaction,
  userId: string,
  stayId: string
): Promise<number> {
  const stay = await tx.lodgingStay.findFirst({
    where: { id: stayId, userId },
    select: { companions: true },
  });
  if (!stay) return 0;
  const keep = await tx.companion.findMany({
    where: {
      userId,
      canonicalName: { in: stay.companions.map((n) => canonicalizeCompanionName(n)) },
    },
    select: { id: true },
  });
  const result = (await tx.lodgingStayCompanion.deleteMany({
    where: { lodgingStayId: stayId, companionId: { notIn: keep.map((c) => c.id) } },
  })) as { count: number };
  return result.count;
}
