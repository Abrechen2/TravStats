import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { EvidenceEntry } from "../../schemas/evidence";
import { loadVisibleDomains } from "../domainVisibility";
import { PERSON_SELECT, toPerson, type SharePerson } from "../sharing/people";
import type { CompanionUseKind } from "./companionJoins";
import { countriesTogether } from "./companionCountries";
import { firstAndLastJourney, type CompanionJourney } from "./companionJourneys";
import { daysTogether, loadTogether, type TogetherEntry } from "./companionTogether";
import { loadPersonFacts, type PersonLoyalty } from "./personFacts";

/**
 * One companion's page (spec 2026-11-22-person-timeline.md). Everything is
 * read under the caller's own `userId`; the counting rules are the ones "Mit
 * wem unterwegs" uses, so the two never disagree.
 */
export interface TimelineRow {
  kind: CompanionUseKind;
  id: string;
  href: string | null;
  title: EvidenceEntry["title"];
  subtitle: EvidenceEntry["subtitle"];
  /** First / last calendar day; null where the entry proves none. */
  from: string | null;
  to: string | null;
  state: "happened" | "planned";
}

export interface PersonDocument {
  id: string;
  name: string | null;
  kind: string | null;
  issuedOn: string | null;
  entry: { kind: CompanionUseKind; id: string; href: string | null } | null;
}

export interface PersonTimeline {
  companion: {
    id: string;
    name: string;
    linkedUser: SharePerson | null;
  };
  kinds: CompanionUseKind[];
  summary: {
    firstTogether: string | null;
    lastTogether: string | null;
    firstJourney: CompanionJourney | null;
    lastJourney: CompanionJourney | null;
    entries: number;
    days: number;
    trips: number;
    flights: number | null;
    nights: number | null;
    countries: number | null;
    plannedTrips: number;
  };
  timeline: TimelineRow[];
  documents: PersonDocument[];
  facts: {
    seats: Array<{
      kind: CompanionUseKind;
      id: string;
      href: string | null;
      title: EvidenceEntry["title"];
      day: string | null;
      seat: string | null;
      seatClass: string | null;
    }>;
    loyalty: PersonLoyalty[];
  };
}

const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function happenedRow(e: TogetherEntry): TimelineRow {
  const days = [...e.dayKeys].sort();
  const fallback = e.entry.date?.value.slice(0, 10) ?? null;
  return {
    kind: e.kind,
    id: e.entry.id,
    href: e.entry.href,
    title: e.entry.title,
    subtitle: e.entry.subtitle,
    from: days[0] ?? fallback,
    to: days[days.length - 1] ?? fallback,
    state: "happened",
  };
}

/** The person's trips that have not started: planned, marked, counted nowhere. */
async function plannedTrips(
  userId: string,
  companionId: string,
  happenedTripIds: ReadonlySet<string>
): Promise<TimelineRow[]> {
  const rows = await prisma.tripCompanion.findMany({
    where: { companionId, trip: { userId, status: { not: "cancelled" } } },
    select: { trip: { select: { id: true, name: true, startDay: true, endDay: true } } },
  });
  return rows
    .map((r) => r.trip)
    .filter((t) => !happenedTripIds.has(t.id))
    .map((t) => ({
      kind: "trip" as const,
      id: t.id,
      href: `/trips/${t.id}`,
      title: { text: t.name },
      subtitle: null,
      from: dayOf(t.startDay),
      to: dayOf(t.endDay) ?? dayOf(t.startDay),
      state: "planned" as const,
    }));
}

/** Oldest first; undated last; ties by kind then id so the order never depends on load order. */
export function sortTimeline(
  rows: TimelineRow[],
  kinds: readonly CompanionUseKind[]
): TimelineRow[] {
  return [...rows].sort((a, b) => {
    if (a.from !== b.from) {
      if (a.from === null) return 1;
      if (b.from === null) return -1;
      return a.from < b.from ? -1 : 1;
    }
    return kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.id.localeCompare(b.id);
  });
}

type LinkedDoc = Awaited<ReturnType<typeof loadDocumentLinks>>[number];

function loadDocumentLinks(userId: string, companionId: string) {
  return prisma.documentLink.findMany({
    where: { companionId, document: { userId } },
    orderBy: { createdAt: "asc" },
    select: {
      flightId: true,
      cruiseId: true,
      lodgingStayId: true,
      tripId: true,
      railJourneyId: true,
      rentalBookingId: true,
      busJourneyId: true,
      ferryJourneyId: true,
      document: {
        select: { id: true, originalName: true, kind: true, issuedOn: true },
      },
    },
  });
}

function entryOfLink(l: LinkedDoc): { kind: CompanionUseKind; id: string } | null {
  if (l.flightId) return { kind: "flight", id: l.flightId };
  if (l.cruiseId) return { kind: "cruise", id: l.cruiseId };
  if (l.lodgingStayId) return { kind: "lodging", id: l.lodgingStayId };
  if (l.tripId) return { kind: "trip", id: l.tripId };
  if (l.railJourneyId) return { kind: "rail", id: l.railJourneyId };
  if (l.rentalBookingId) return { kind: "rental", id: l.rentalBookingId };
  if (l.busJourneyId) return { kind: "bus", id: l.busJourneyId };
  if (l.ferryJourneyId) return { kind: "ferry", id: l.ferryJourneyId };
  return null;
}

export async function personTimeline(userId: string, companionId: string): Promise<PersonTimeline> {
  const companion = await prisma.companion.findFirst({
    where: { id: companionId, userId },
    select: {
      id: true,
      displayName: true,
      linkedUser: { select: PERSON_SELECT },
    },
  });
  if (!companion) throw new AppError("Companion not found", 404, "COMPANION_NOT_FOUND");

  const visible = await loadVisibleDomains(userId);
  const { kinds, byCompanion } = await loadTogether(userId, visible);
  const entries = byCompanion.get(companionId) ?? [];
  const happened = entries.map(happenedRow);
  const happenedTripIds = new Set(entries.filter((e) => e.kind === "trip").map((e) => e.entry.id));
  const [countries, planned, facts, links] = await Promise.all([
    countriesTogether(userId, new Map([[companionId, entries]])),
    plannedTrips(userId, companionId, happenedTripIds),
    loadPersonFacts(companionId, kinds, new Set(entries.map((e) => `${e.kind}:${e.entry.id}`))),
    loadDocumentLinks(userId, companionId),
  ]);
  const timeline = sortTimeline([...happened, ...planned], kinds);
  const rowOf = new Map(timeline.map((r) => [`${r.kind}:${r.id}`, r]));

  const days = daysTogether(entries);
  const stays = entries.filter((e) => e.kind === "lodging");
  const stayNights = stays.reduce((n, e) => n + e.dayKeys.length, 0);
  const codes = countries.get(companionId)?.codes ?? null;
  const { first, last } = firstAndLastJourney(entries, kinds);

  const documents = links.flatMap((l): PersonDocument[] => {
    const ref = entryOfLink(l);
    // An entry of a domain switched off is not shown, its documents with it.
    if (ref && !kinds.includes(ref.kind)) return [];
    const row = ref ? rowOf.get(`${ref.kind}:${ref.id}`) : undefined;
    return [
      {
        id: l.document.id,
        name: l.document.originalName,
        kind: l.document.kind,
        issuedOn: dayOf(l.document.issuedOn),
        entry: ref ? { ...ref, href: row?.href ?? null } : null,
      },
    ];
  });

  const seats = facts.seats
    .flatMap((s) => {
      const row = rowOf.get(`${s.kind}:${s.entryId}`);
      return row
        ? [
            {
              kind: s.kind,
              id: s.entryId,
              href: row.href,
              title: row.title,
              day: row.from,
              seat: s.seat,
              seatClass: s.seatClass,
            },
          ]
        : [];
    })
    .sort((a, b) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || a.id.localeCompare(b.id));

  const count = (kind: CompanionUseKind): number => entries.filter((e) => e.kind === kind).length;
  return {
    companion: {
      id: companion.id,
      name: companion.displayName,
      linkedUser: companion.linkedUser ? toPerson(companion.linkedUser) : null,
    },
    kinds,
    summary: {
      firstTogether: days[0] ?? null,
      lastTogether: days.length > 0 ? days[days.length - 1] : null,
      firstJourney: first,
      lastJourney: last,
      entries: entries.length,
      days: days.length,
      trips: count("trip"),
      flights: kinds.includes("flight") ? count("flight") : null,
      nights: !kinds.includes("lodging")
        ? null
        : stays.length === 0
          ? 0
          : stayNights === 0
            ? null
            : stayNights,
      countries: codes === null ? null : codes.length,
      plannedTrips: planned.length,
    },
    timeline,
    documents,
    facts: { seats, loyalty: facts.loyalty },
  };
}
