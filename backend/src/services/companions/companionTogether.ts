import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import type { DomainKey } from "../../shared/domains";
import type { EvidenceEntry } from "../../schemas/evidence";
import { loadCrossDomainPopulation } from "../evidence/crossDomainPopulations";
import { tripEvidenceEntry } from "../evidence/entryMappersDomains";
import { userToday } from "../stats/userToday";
import { COMPANION_JOINS, COMPANION_USE_KINDS, type CompanionUseKind } from "./companionJoins";
import { loadStayLinks } from "./companionStays";

/**
 * "Mit wem unterwegs": which of the caller's entries each companion was on,
 * and the days those entries cover.
 *
 * An entry counts only once it has HAPPENED, by the rule its own domain's
 * statistics use — the overview's population (`loadCrossDomainPopulation`), so
 * "days together" is the same day key, on the same clock (ADR 0002: each
 * domain's local day), that the overview's "aktive Tage" counts. A planned
 * flight with someone is not yet a flight together. Trips, which are no domain,
 * count once they have started; their days are the trip's own local days
 * (`startDay`..`endDay`, cut at the user's today) — a trip with no dates
 * proves no day. A lodging stay names its companions as text
 * (`companionStays.ts`) and counts, like on the lodging tab, once its
 * check-out is past, on the nights it covered.
 *
 * Paying an expense is NOT travelling together (owner, 2026-10-22): the payer
 * link never enters this population.
 */
export interface TogetherEntry {
  kind: CompanionUseKind;
  entry: EvidenceEntry;
  /** `YYYY-MM-DD`, each on its own entry's clock; possibly none. */
  dayKeys: string[];
  /** ISO codes the entry's own places lie in (a stay: its house's); none for a trip or rental. */
  touched: string[];
}

/** Kinds that are a domain (and gated like one); `trip` is never hidden. */
const DOMAIN_KINDS = COMPANION_USE_KINDS.filter(
  (k): k is Exclude<CompanionUseKind, "trip"> => k !== "trip"
);

/** The kinds a user with these visible domains sees, in display order. */
export function visibleUseKinds(visible: readonly DomainKey[]): CompanionUseKind[] {
  return COMPANION_USE_KINDS.filter(
    (k) => k === "trip" || (visible as readonly string[]).includes(k)
  );
}

/** companion id → entry ids per kind, for the caller's companions only. */
async function loadLinks(
  userId: string,
  kinds: readonly CompanionUseKind[]
): Promise<Map<string, Map<CompanionUseKind, Set<string>>>> {
  const out = new Map<string, Map<CompanionUseKind, Set<string>>>();
  for (const join of COMPANION_JOINS) {
    if (!kinds.includes(join.kind)) continue;
    const table = Prisma.raw(`"${join.table}"`);
    const entry = Prisma.raw(`"${join.entry}"`);
    const rows = await prisma.$queryRaw<{ companionId: string; entryId: string }[]>(Prisma.sql`
      SELECT j.companion_id AS "companionId", j.${entry} AS "entryId"
      FROM ${table} j JOIN companions c ON c.id = j.companion_id
      WHERE c.user_id = ${userId}`);
    for (const row of rows) {
      const byKind = out.get(row.companionId) ?? new Map<CompanionUseKind, Set<string>>();
      const ids = byKind.get(join.kind) ?? new Set<string>();
      ids.add(row.entryId);
      byKind.set(join.kind, ids);
      out.set(row.companionId, byKind);
    }
  }
  if (kinds.includes("lodging")) {
    const catalogue = await prisma.companion.findMany({
      where: { userId },
      select: { id: true, canonicalName: true },
    });
    const stays = await loadStayLinks(prisma, userId, catalogue);
    for (const [companionId, ids] of stays.byCompanion) {
      const byKind = out.get(companionId) ?? new Map<CompanionUseKind, Set<string>>();
      byKind.set("lodging", ids);
      out.set(companionId, byKind);
    }
  }
  return out;
}

/** stay id → its house's ISO country, for the stays some companion is on. */
async function stayCountries(userId: string, ids: ReadonlySet<string>) {
  if (ids.size === 0) return new Map<string, string[]>();
  const rows = await prisma.lodgingStay.findMany({
    where: { userId, id: { in: [...ids] } },
    select: { id: true, lodging: { select: { isoCountryCode: true } } },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      r.lodging.isoCountryCode ? [r.lodging.isoCountryCode.toUpperCase()] : [],
    ])
  );
}

/** Every calendar day from `from` to `to` inclusive, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** A trip's day as stored (`@db.Date`, a local calendar day), or null. */
const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** The caller's trips that have started, as together-entries keyed by id. */
async function loadTrips(userId: string, ids: ReadonlySet<string>) {
  if (ids.size === 0) return new Map<string, TogetherEntry>();
  const [rows, today] = await Promise.all([
    prisma.trip.findMany({
      where: { userId, id: { in: [...ids] } },
      select: { id: true, name: true, status: true, startDate: true, startDay: true, endDay: true },
    }),
    userToday(userId),
  ]);
  const out = new Map<string, TogetherEntry>();
  for (const row of rows) {
    const start = dayOf(row.startDay);
    const started = start ? start <= today : row.status === "completed";
    if (!started) continue;
    const end = dayOf(row.endDay) ?? start;
    const last = end && end < today ? end : today;
    out.set(row.id, {
      kind: "trip",
      entry: tripEvidenceEntry(row, { subtitle: null }),
      dayKeys: start && last >= start ? daysBetween(start, last) : [],
      touched: [],
    });
  }
  return out;
}

export interface TogetherPopulation {
  /** The kinds the caller sees, in display order. */
  kinds: CompanionUseKind[];
  /** companion id → the happened entries they were on, of visible kinds. */
  byCompanion: Map<string, TogetherEntry[]>;
}

/** Loads the population for every companion of the caller at once. */
export async function loadTogether(
  userId: string,
  visible: readonly DomainKey[]
): Promise<TogetherPopulation> {
  const kinds = visibleUseKinds(visible);
  const domains = DOMAIN_KINDS.filter((k) => kinds.includes(k));
  const links = await loadLinks(userId, kinds);
  const idsOf = (kind: CompanionUseKind) =>
    new Set([...links.values()].flatMap((m) => [...(m.get(kind) ?? [])]));
  const [population, trips, stays] = await Promise.all([
    loadCrossDomainPopulation(userId, domains),
    loadTrips(userId, idsOf("trip")),
    stayCountries(userId, idsOf("lodging")),
  ]);
  const happened = new Map<string, TogetherEntry>(
    [...trips].map(([id, entry]) => [`trip:${id}`, entry])
  );
  const touched = new Map(
    population.countryRows.map((row) => [`${row.domain}:${row.entry.id}`, row.countries])
  );
  for (const event of population.events) {
    const key = `${event.domain}:${event.entry.id}`;
    happened.set(key, {
      kind: event.domain as CompanionUseKind,
      entry: event.entry,
      dayKeys: event.dayKeys,
      // A stay's country row is its HOUSE's, keyed by the house: read it per stay.
      touched:
        event.domain === "lodging" ? (stays.get(event.entry.id) ?? []) : (touched.get(key) ?? []),
    });
  }
  const byCompanion = new Map<string, TogetherEntry[]>();
  for (const [companionId, byKind] of links) {
    const entries: TogetherEntry[] = [];
    for (const [kind, ids] of byKind) {
      for (const id of ids) {
        const hit = happened.get(`${kind}:${id}`);
        if (hit) entries.push(hit);
      }
    }
    byCompanion.set(companionId, entries);
  }
  return { kinds, byCompanion };
}

/** The distinct days a set of entries covers — a day two entries share counts once. */
export function daysTogether(entries: readonly TogetherEntry[]): string[] {
  return [...new Set(entries.flatMap((e) => e.dayKeys))].sort();
}
