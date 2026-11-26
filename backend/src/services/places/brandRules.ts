/**
 * Smart lists: a place list that follows a chain (spec 2026-11-22-brand-lists.md).
 *
 * The rule lives on `PlaceListBrandRule` (one row per brand, the list's dwell window, distance and
 * auto-accept repeated on each). A TravTrack visit finding that matches carries the match in
 * `evidence.visit.brandMatches`; this file reads and writes everything around it: the rules, the
 * accept hook (list entry, brand on the place), the suggestions a list or a place shows, the
 * "recently taken automatically" feed and its undo.
 *
 * Automation marks what it writes (`createdBy = "brandRule"` on the place, the visit and the list
 * entry). Undo removes ONLY records carrying that mark: a visit, entry or place the owner had
 * already is never touched, and a visit that has since gained a note or rating is kept.
 */
import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { recheckAchievements } from "../../utils/achievements";
import { toLocal } from "../../shared/time/instant";
import { classifyVisit } from "../../shared/placeCounting";
import { now as clockNow } from "../../shared/time/clock";
import { runUnfiltered } from "../provenance/recordedOnly";
import type { BrandRuleInput } from "../travtrack/visits/brandMatch";
import { staySuggestionsEnabled } from "../settings/suggestionSwitches";

export const BRAND_RULE = "brandRule";
export const AUTO_FEED_LIMIT = 20;

export type RuleSettings = {
  minDwellMinutes: number;
  maxDwellMinutes: number;
  maxDistanceM: number;
  autoAcceptDistanceM: number;
  autoAccept: boolean;
};

export const DEFAULT_RULE_SETTINGS: RuleSettings = {
  minDwellMinutes: 5,
  maxDwellMinutes: 60,
  maxDistanceM: 100,
  autoAcceptDistanceM: 60,
  autoAccept: false,
};

export type RuleBrand = { brandWikidataId: string; brandName: string };

export type ListRule = { listId: string; brands: RuleBrand[] } & RuleSettings;

/** Every rule of the account, with its list's name, for the matcher. */
export async function loadBrandRules(userId: string): Promise<BrandRuleInput[]> {
  const rows = await prisma.placeListBrandRule.findMany({
    where: { userId },
    include: { list: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    listId: r.listId,
    listName: r.list.name,
    brandWikidataId: r.brandWikidataId,
    brandName: r.brandName,
    minDwellMinutes: r.minDwellMinutes,
    maxDwellMinutes: r.maxDwellMinutes,
    maxDistanceM: r.maxDistanceM,
    autoAcceptDistanceM: r.autoAcceptDistanceM,
    autoAccept: r.autoAccept,
  }));
}

async function ownList(userId: string, listId: string) {
  const list = await prisma.placeList.findFirst({
    where: { id: listId, userId },
    select: { id: true, curatedKey: true },
  });
  if (!list) throw new AppError("List not found", 404);
  return list;
}

export async function getListRule(userId: string, listId: string): Promise<ListRule | null> {
  await ownList(userId, listId);
  const rows = await prisma.placeListBrandRule.findMany({
    where: { listId, userId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return null;
  const first = rows[0];
  return {
    listId,
    brands: rows.map((r) => ({ brandWikidataId: r.brandWikidataId, brandName: r.brandName })),
    minDwellMinutes: first.minDwellMinutes,
    maxDwellMinutes: first.maxDwellMinutes,
    maxDistanceM: first.maxDistanceM,
    autoAcceptDistanceM: first.autoAcceptDistanceM,
    autoAccept: first.autoAccept,
  };
}

/** Replaces the list's rule. A shipped checklist's membership comes from the catalogue: no rule. */
export async function setListRule(
  userId: string,
  listId: string,
  brands: readonly RuleBrand[],
  settings: RuleSettings
): Promise<ListRule> {
  const list = await ownList(userId, listId);
  if (list.curatedKey)
    throw new AppError("A shipped checklist cannot follow a chain", 409, "LIST_IS_CURATED");
  const unique = [...new Map(brands.map((b) => [b.brandWikidataId, b])).values()];
  await prisma.$transaction(async (tx) => {
    await tx.placeListBrandRule.deleteMany({
      where: { listId, userId, brandWikidataId: { notIn: unique.map((b) => b.brandWikidataId) } },
    });
    for (const b of unique)
      await tx.placeListBrandRule.upsert({
        where: { listId_brandWikidataId: { listId, brandWikidataId: b.brandWikidataId } },
        create: { listId, userId, ...b, ...settings },
        update: { brandName: b.brandName, ...settings },
      });
  });
  return { listId, brands: unique, ...settings };
}

export async function clearListRule(userId: string, listId: string): Promise<void> {
  await ownList(userId, listId);
  await prisma.placeListBrandRule.deleteMany({ where: { listId, userId } });
}

type EvidenceMatches = {
  ruleId: string;
  listId: string;
  brandWikidataId: string;
  strength: "id" | "name";
  auto: boolean;
}[];

/** The smart-list matches a visit finding carries; empty for any other finding. */
export function matchesOf(evidence: unknown): EvidenceMatches {
  const list = (evidence as { visit?: { brandMatches?: unknown } } | null)?.visit?.brandMatches;
  return Array.isArray(list) ? (list as EvidenceMatches) : [];
}

/**
 * The accept hook (inside the accept transaction): put the place into every list whose rule matched
 * and the rule still exists; remember the brand on the place when the match was by id. `createdBy`
 * is `brandRule` only for the automatic path, so a confirmed suggestion is the owner's own entry.
 */
export async function applyBrandMatches(
  tx: DbTransaction,
  userId: string,
  evidence: unknown,
  placeId: string,
  createdBy: string | null
): Promise<void> {
  const matches = matchesOf(evidence);
  if (matches.length === 0) return;
  const rules = await tx.placeListBrandRule.findMany({
    where: { userId, id: { in: matches.map((m) => m.ruleId) } },
    select: { id: true, listId: true },
  });
  const alive = new Set(rules.map((r) => r.id));
  for (const m of matches) {
    if (!alive.has(m.ruleId)) continue;
    const present = await tx.placeListEntry.findUnique({
      where: { listId_placeId: { listId: m.listId, placeId } },
      select: { id: true },
    });
    if (!present) {
      const last = await tx.placeListEntry.aggregate({
        where: { listId: m.listId },
        _max: { sortIdx: true },
      });
      await tx.placeListEntry.create({
        data: {
          listId: m.listId,
          placeId,
          sortIdx: (last._max.sortIdx ?? -1) + 1,
          ...(createdBy ? { createdBy } : {}),
        },
      });
    }
    if (m.strength === "id")
      await tx.place.updateMany({
        where: { id: placeId, userId, brandWikidataId: null },
        data: { brandWikidataId: m.brandWikidataId },
      });
  }
}

const matchFilter = (listId: string, extra: Record<string, unknown> = {}) =>
  ({
    path: ["visit", "brandMatches"],
    array_contains: [{ listId, ...extra }],
  }) as Prisma.JsonFilter;

export type SuggestionView = {
  id: string;
  placeId: string | null;
  name: string | null;
  startAt: string;
  endAt: string;
  /** Wall clock at the place (`zone`), as accepting it expects. */
  startLocal: string;
  endLocal: string;
  zone: string;
  durationMinutes: number;
  distanceM: number | null;
  source: "travtrack";
  strength: "id" | "name";
  lists: { listId: string; listName: string }[];
  lat: number;
  lon: number;
};

type StayRow = {
  id: string;
  placeId: string | null;
  name: string | null;
  startAt: Date;
  endAt: Date;
  lat: number;
  lon: number;
  zone: string;
  evidence: unknown;
};

function viewOf(row: StayRow): SuggestionView {
  const visit = (row.evidence as { visit?: { distanceM?: number } } | null)?.visit;
  const matches = matchesOf(row.evidence) as (EvidenceMatches[number] & { listName?: string })[];
  return {
    id: row.id,
    placeId: row.placeId,
    name: row.name,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    startLocal: toLocal(row.startAt, row.zone).local.slice(0, 16),
    endLocal: toLocal(row.endAt, row.zone).local.slice(0, 16),
    zone: row.zone,
    durationMinutes: Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60_000),
    distanceM: visit?.distanceM ?? null,
    source: "travtrack",
    strength: matches.some((m) => m.strength === "id") ? "id" : (matches[0]?.strength ?? "name"),
    lists: matches.map((m) => ({ listId: m.listId, listName: m.listName ?? "" })),
    lat: row.lat,
    lon: row.lon,
  };
}

/** List names are read live: a rename after the match must not leave the old name on screen. */
async function named(userId: string, views: SuggestionView[]): Promise<SuggestionView[]> {
  const ids = [...new Set(views.flatMap((v) => v.lists.map((l) => l.listId)))];
  if (ids.length === 0) return views;
  const lists = await prisma.placeList.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(lists.map((l) => [l.id, l.name]));
  return views.map((v) => ({
    ...v,
    lists: v.lists
      .filter((l) => nameOf.has(l.listId))
      .map((l) => ({ listId: l.listId, listName: nameOf.get(l.listId)! })),
  }));
}

const STAY_SELECT = {
  id: true,
  placeId: true,
  name: true,
  startAt: true,
  endAt: true,
  lat: true,
  lon: true,
  zone: true,
  evidence: true,
} as const;

/** Pending TravTrack visit findings of an existing place: the "were you here?" on the place page. */
export async function suggestionsForPlace(userId: string, placeId: string) {
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      placeId,
      status: "pending",
      provider: "travtrack",
      evidence: { path: ["visit"], not: Prisma.AnyNull },
    },
    select: STAY_SELECT,
    orderBy: { startAt: "desc" },
    take: 20,
  });
  return named(userId, rows.map(viewOf));
}

/** Pending matches of a list whose venue is not one of the owner's places yet: new outlets. */
export async function newOutletsForList(userId: string, listId: string) {
  await ownList(userId, listId);
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      status: "pending",
      provider: "travtrack",
      placeId: null,
      evidence: matchFilter(listId) as Prisma.JsonFilter,
    },
    select: STAY_SELECT,
    orderBy: { startAt: "desc" },
    take: 50,
  });
  return named(userId, rows.map(viewOf));
}

/** Matches of the list taken without asking, newest first, that can still be undone. */
export async function recentlyAutoAccepted(userId: string, listId: string) {
  await ownList(userId, listId);
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      status: "accepted",
      provider: "travtrack",
      evidence: matchFilter(listId, { auto: true }) as Prisma.JsonFilter,
    },
    select: STAY_SELECT,
    orderBy: { resolvedAt: "desc" },
    take: AUTO_FEED_LIMIT,
  });
  return named(userId, rows.map(viewOf));
}

/** Most pending confirmations a list's section shows; the count beside it is exact. */
export const PENDING_LIMIT = 100;
/** A question is pending while it waits or while a crashed accept still claims it (as the inbox). */
const PENDING = { in: ["pending", "accepting"] };

/**
 * Pending visit confirmations this list's rule produced at places the owner already has (owner
 * 2026-11-26: "show 'ausstehende Bestätigung' above the list itself"). A match at a venue that is
 * no place yet is a new outlet and stays in that section. With stay suggestions switched off
 * there is no question to show, as in the inbox.
 */
export async function pendingForList(userId: string, listId: string) {
  await ownList(userId, listId);
  if (!(await staySuggestionsEnabled(userId))) return { rows: [], total: 0 };
  const where = {
    userId,
    status: PENDING,
    provider: "travtrack",
    placeId: { not: null },
    evidence: matchFilter(listId) as Prisma.JsonFilter,
  };
  const [rows, total] = await Promise.all([
    prisma.dawarichStay.findMany({
      where,
      select: STAY_SELECT,
      orderBy: [{ startAt: "desc" }, { id: "asc" }],
      take: PENDING_LIMIT,
    }),
    prisma.dawarichStay.count({ where }),
  ]);
  return { rows: await named(userId, rows.map(viewOf)), total };
}

/** Upper bound of pending matches read for the overview's badges. */
const COUNT_SCAN_CAP = 5000;

/**
 * Per smart list, how many of its matches wait for an answer (new outlets and visits at known
 * places together): the badge on the lists overview. Lists without a pending match are absent.
 */
export async function pendingCounts(userId: string): Promise<Record<string, number>> {
  if (!(await staySuggestionsEnabled(userId))) return {};
  const rows = await prisma.dawarichStay.findMany({
    where: {
      userId,
      status: PENDING,
      provider: "travtrack",
      evidence: { path: ["visit", "brandMatches"], not: Prisma.AnyNull },
    },
    select: { evidence: true },
    take: COUNT_SCAN_CAP,
  });
  const lists = new Set(
    (await prisma.placeListBrandRule.findMany({ where: { userId }, select: { listId: true } })).map(
      (r) => r.listId
    )
  );
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const listId of new Set(matchesOf(row.evidence).map((m) => m.listId))) {
      if (lists.has(listId)) out[listId] = (out[listId] ?? 0) + 1;
    }
  }
  return out;
}

export type UndoResult = {
  removedVisit: boolean;
  removedEntries: number;
  removedPlace: boolean;
  keptVisit: "notes" | "notAutomatic" | null;
};

/**
 * Take back an automatic acceptance: remove what the automation wrote and nothing else, then mark
 * the finding rejected (it keeps its coordinates, so it never comes back).
 */
export async function undoAutoAccepted(userId: string, stayId: string): Promise<UndoResult> {
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.dawarichStay.findFirst({
      where: { id: stayId, userId, status: "accepted", provider: "travtrack" },
    });
    if (!row) throw new AppError("Automatic entry not found", 404, "AUTO_ENTRY_NOT_FOUND");
    const autoMatches = matchesOf(row.evidence).filter((m) => m.auto);
    if (autoMatches.length === 0)
      throw new AppError("Not an automatic entry", 409, "NOT_AUTOMATIC");
    const out: UndoResult = {
      removedVisit: false,
      removedEntries: 0,
      removedPlace: false,
      keptVisit: null,
    };
    if (row.visitId) {
      const visit = await tx.placeVisit.findUnique({
        where: { id: row.visitId },
        include: {
          _count: {
            select: { photos: true, documents: true, documentLinks: true, expenses: true },
          },
        },
      });
      // Anything the owner added since — a note, a rating, a photo, a document, an expense — makes
      // the visit theirs: deleting it would cascade their additions away with it.
      const added =
        !!visit &&
        (!!visit.notes || visit.rating !== null || Object.values(visit._count).some((n) => n > 0));
      if (visit && visit.createdBy !== BRAND_RULE) out.keptVisit = "notAutomatic";
      else if (visit && added) out.keptVisit = "notes";
      else if (visit) {
        await tx.placeVisit.delete({ where: { id: visit.id } });
        out.removedVisit = true;
      }
    }
    if (row.placeId) {
      const entries = await tx.placeListEntry.deleteMany({
        where: {
          placeId: row.placeId,
          createdBy: BRAND_RULE,
          listId: { in: autoMatches.map((m) => m.listId) },
        },
      });
      out.removedEntries = entries.count;
      const place = await tx.place.findFirst({
        where: { id: row.placeId, userId },
        select: {
          createdBy: true,
          notes: true,
          tags: true,
          coverPhotoId: true,
          _count: {
            select: {
              visits: true,
              listEntries: true,
              roadtripStations: true,
              photoJourneys: true,
              captures: true,
            },
          },
        },
      });
      // A place the owner has since written on (notes, tags, a cover) or used elsewhere is theirs.
      const ownerTouched =
        !!place &&
        (!!place.notes ||
          place.tags.length > 0 ||
          place.coverPhotoId !== null ||
          place._count.roadtripStations > 0 ||
          place._count.photoJourneys > 0 ||
          place._count.captures > 0);
      if (
        place?.createdBy === BRAND_RULE &&
        !ownerTouched &&
        place._count.visits === 0 &&
        place._count.listEntries === 0
      ) {
        await tx.place.delete({ where: { id: row.placeId } });
        out.removedPlace = true;
      } else if (
        place &&
        out.removedVisit &&
        (row.evidence as { promotedVisited?: unknown } | null)?.promotedVisited === true
      ) {
        // This acceptance is what switched `visited` on (a flag the owner set stays untouched);
        // with its visit gone the flag follows the visits that are left (every one, a hidden
        // purpose included), not the rejected one.
        const left = await runUnfiltered(
          async () =>
            await tx.placeVisit.findMany({
              where: { placeId: row.placeId! },
              select: { visitedAt: true, visitedAtUtc: true },
            })
        );
        const at = clockNow();
        if (!left.some((v) => classifyVisit(v, at) === "visited")) {
          await tx.place.update({ where: { id: row.placeId }, data: { visited: false } });
        }
      }
    }
    await tx.dawarichStay.update({
      where: { id: row.id },
      data: { status: "rejected", resolvedAt: new Date(), visitId: null },
    });
    return out;
  });
  await recheckAchievements(userId, "Automatic place visit undone");
  return result;
}
