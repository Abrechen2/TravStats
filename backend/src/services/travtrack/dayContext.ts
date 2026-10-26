import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import type { DomainKey } from "../../shared/domains";
import { homePlaceSchema } from "../../schemas/companionData";
import { loadVisibleDomains } from "../domainVisibility";
import { staySuggestionsEnabled } from "../settings/suggestionSwitches";
import {
  ENTRY_WINDOW_ADAPTERS,
  logbookWindows,
  type EntryWindow,
} from "../locationEvidence/journeys/entryWindows";
import { parseJourneyEvidence } from "../locationEvidence/journeys/evidence";
import { TRIP_RECORDING_TRIP_SELECT, tripSpanInstants } from "../tripRecording/bounds";
import type { StoredPoint } from "../tripRecording/segments";
import { inPrivacyZone } from "./classify";
import { DAY_LABEL_DESCRIBERS, type Described, type Pin } from "./dayContextLabels";
import { unlabelledStretches } from "./dayMovement";
import type { SafeSpan, Span } from "./readSafe";

/**
 * What TravStats knows of one day of the TravTrack history (TravTrack plan
 * T6, labelled from every domain in E10). The labels are TravStats' records,
 * read from their own tables — never inferred from points:
 *
 *   - every visible domain's entries of the day, through the entry-window
 *     adapters (`logbookWindows`, E7) and described by `dayContextLabels.ts`
 *     — a domain added there appears here without a line changed;
 *   - the trips spanning the day;
 *   - the stretches within 300 m of the home place, read from the
 *     privacy-safe points only, so a home that is also a zone shows no time
 *     at home;
 *   - the day's OPEN TravTrack questions (a stay, a journey's open runs),
 *     linked to their inbox card; answered, they are gone;
 *   - the moving stretches no entry covers: "unterwegs, ohne Eintrag",
 *     `unlabelled: true`, never with a guessed mode (`dayMovement.ts`).
 *
 * Map anchors: the record's own pin, or — for a record without one, a home
 * stretch, a moving stretch — the first privacy-safe vertex of its stretch.
 * A pin inside a privacy circle is not replaced by anything: the entry is
 * listed without an anchor. A trip frames the day and has none.
 */

export const HOME_RADIUS_KM = 0.3;

export type DayContextKind = DomainKey | "trip" | "home" | "suggestion" | "movement";

export type DayContextEntry = Span & {
  kind: DayContextKind;
  id: string | null;
  label: string;
  /** The web path the label opens, or null. */
  href: string | null;
  /** Where the label sits on the map, or null. Never inside a privacy circle. */
  anchor: Pin | null;
  /** A moving stretch no entry covers. */
  unlabelled: boolean;
  /** Which TravTrack question, on a `suggestion`. */
  suggestion?: "stay" | "journey";
};

/** The part of `span` inside the day; an instant counts when it lies in it. */
function clip(span: Span, window: Span): Span | null {
  const fromMs = Math.max(span.fromMs, window.fromMs);
  const untilMs = Math.min(span.untilMs, window.untilMs);
  if (untilMs < fromMs || fromMs >= window.untilMs) return null;
  if (untilMs === fromMs && span.untilMs !== span.fromMs) return null;
  return { fromMs, untilMs };
}

/** The first privacy-safe vertex inside `span`, or null. */
function firstVertex(segments: readonly StoredPoint[][], span: Span): Pin | null {
  for (const segment of segments) {
    const p = segment.find((q) => q[0] >= span.fromMs && q[0] <= span.untilMs);
    if (p) return { lat: p[1], lon: p[2] };
  }
  return null;
}

/** A pin outside every circle, or null. */
const safePin = (pin: Pin, read: SafeSpan): Pin | null =>
  inPrivacyZone(pin, read.circles) ? null : pin;

const anchorOf = (pin: Pin | null, span: Span, read: SafeSpan): Pin | null =>
  pin ? safePin(pin, read) : firstVertex(read.segments, span);

const UNNAMED: Described = { label: "", href: null, pin: null };

async function logbookContext(
  userId: string,
  window: Span,
  windows: readonly EntryWindow[],
  read: SafeSpan
): Promise<DayContextEntry[]> {
  const visible = new Set<string>(await loadVisibleDomains(userId));
  const shown = windows.filter((w) => visible.has(w.domain));
  const domains = [...new Set(shown.map((w) => w.domain))];
  const described = new Map(
    await Promise.all(
      domains.map(async (domain) => {
        const describe = (DAY_LABEL_DESCRIBERS as Partial<typeof DAY_LABEL_DESCRIBERS>)[domain];
        const ids = shown.filter((w) => w.domain === domain).map((w) => w.id);
        return [domain, describe ? await describe(userId, ids) : new Map()] as const;
      })
    )
  );
  return shown.flatMap((w): DayContextEntry[] => {
    const record = described.get(w.domain)?.get(w.id) ?? UNNAMED;
    const span = clip(record.span ?? w, window);
    if (!span) return [];
    return [
      {
        kind: w.domain,
        id: w.id,
        label: record.label,
        href: record.href,
        anchor: anchorOf(record.pin, span, read),
        unlabelled: false,
        ...span,
      },
    ];
  });
}

async function tripContext(userId: string, window: Span): Promise<DayContextEntry[]> {
  const wide = 2 * 86_400_000;
  const before = new Date(window.untilMs + wide);
  const after = new Date(window.fromMs - wide);
  const trips = await prisma.trip.findMany({
    where: {
      userId,
      OR: [
        { startDay: { lte: before }, endDay: { gte: after } },
        { startDay: null, startDate: { lte: before }, endDate: { gte: after } },
      ],
    },
    select: TRIP_RECORDING_TRIP_SELECT,
  });
  const out: DayContextEntry[] = [];
  for (const trip of trips) {
    const span = await tripSpanInstants(userId, trip);
    const shown = span && span.untilMs > span.fromMs ? clip(span, window) : null;
    if (shown && shown.untilMs > shown.fromMs) {
      out.push({
        kind: "trip",
        id: trip.id,
        label: trip.name,
        href: `/trips/${trip.id}`,
        anchor: null,
        unlabelled: false,
        ...shown,
      });
    }
  }
  return out;
}

/** The stretches within `HOME_RADIUS_KM` of home, from the privacy-safe points only. */
async function homeContext(userId: string, read: SafeSpan): Promise<DayContextEntry[]> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { homePlace: true },
  });
  const parsed = homePlaceSchema.safeParse(settings?.homePlace);
  if (!parsed.success) return [];
  const home = parsed.data;
  const out: DayContextEntry[] = [];
  for (const segment of read.segments) {
    let run: StoredPoint[] = [];
    const flush = () => {
      if (run.length > 1) {
        out.push({
          kind: "home",
          id: null,
          label: home.name,
          href: null,
          anchor: { lat: run[0][1], lon: run[0][2] },
          unlabelled: false,
          fromMs: run[0][0],
          untilMs: run[run.length - 1][0],
        });
      }
      run = [];
    };
    for (const p of segment) {
      if (haversineKm({ lat: p[1], lon: p[2] }, home) <= HOME_RADIUS_KM) run.push(p);
      else flush();
    }
    flush();
  }
  return out;
}

/** The inbox card of a question: `InboxWorkspace`'s list view shows `?item=<source>:<id>` alone. */
const inboxHref = (source: "dawarich" | "location", id: string) =>
  `/pending-updates?view=list&item=${encodeURIComponent(`${source}:${id}`)}`;

/**
 * The day's open TravTrack questions. A stay is one label; a journey question
 * is one label per run still open — a run answered (linked or closed) is gone
 * from the day as the whole question is once it is answered.
 *
 * A stay is asked only while the account has stay suggestions on
 * (forgejo#306): off, the inbox has no stay tab, so a label would link into
 * nothing. Journey questions have no switch of their own — they live behind
 * the `travTrack` beta key, which this day view sits behind as well.
 */
async function suggestionContext(
  userId: string,
  window: Span,
  read: SafeSpan
): Promise<{ entries: DayContextEntry[]; runs: Span[] }> {
  const overlapping = { lt: new Date(window.untilMs) };
  const staysShown = await staySuggestionsEnabled(userId);
  const [stays, journeys] = await Promise.all([
    staysShown
      ? prisma.dawarichStay.findMany({
          where: {
            userId,
            provider: "travtrack",
            status: "pending",
            startAt: overlapping,
            endAt: { gt: new Date(window.fromMs) },
          },
          select: { id: true, name: true, startAt: true, endAt: true, lat: true, lon: true },
        })
      : Promise.resolve([]),
    prisma.locationSuggestion.findMany({
      where: {
        userId,
        kind: "journey",
        provider: "travtrack",
        status: "pending",
        windowFrom: overlapping,
        windowUntil: { gt: new Date(window.fromMs) },
      },
      select: { id: true, evidence: true },
    }),
  ]);
  const entries: DayContextEntry[] = [];
  for (const s of stays) {
    const span = clip({ fromMs: s.startAt.getTime(), untilMs: s.endAt.getTime() }, window);
    if (!span) continue;
    entries.push({
      kind: "suggestion",
      suggestion: "stay",
      id: s.id,
      label: s.name ?? "",
      href: inboxHref("dawarich", s.id),
      anchor: safePin({ lat: s.lat, lon: s.lon }, read),
      unlabelled: false,
      ...span,
    });
  }
  const runs: Span[] = [];
  for (const j of journeys) {
    for (const run of parseJourneyEvidence(j.evidence)?.runs ?? []) {
      const span = run.state === "open" ? clip(run, window) : null;
      if (!span) continue;
      runs.push(span);
      entries.push({
        kind: "suggestion",
        suggestion: "journey",
        id: j.id,
        label: String(Math.round(run.km)),
        href: inboxHref("location", j.id),
        anchor: safePin(run.start, read),
        unlabelled: false,
        ...span,
      });
    }
  }
  return { entries, runs };
}

/** Whether an entry window holds a journey (a ride, a crossing), not a stay or a visit. */
const holdsMovement = (w: EntryWindow) => {
  const adapter = ENTRY_WINDOW_ADAPTERS[w.domain];
  return adapter !== undefined && !("none" in adapter) && adapter.movement === true;
};

export async function dayContext(
  userId: string,
  window: Span,
  read: SafeSpan
): Promise<DayContextEntry[]> {
  const windows = await logbookWindows(userId, window);
  const [logbook, trips, home, suggestions] = await Promise.all([
    logbookContext(userId, window, windows, read),
    tripContext(userId, window),
    homeContext(userId, read),
    suggestionContext(userId, window, read),
  ]);
  // Covered: every journey the logbook holds — shown or not — and every open journey question.
  const covered = [...windows.filter(holdsMovement), ...suggestions.runs];
  const moving = unlabelledStretches(read.segments, covered).map((s): DayContextEntry => ({
    kind: "movement",
    id: null,
    label: "",
    href: null,
    anchor: s.anchor,
    unlabelled: true,
    fromMs: s.fromMs,
    untilMs: s.untilMs,
  }));
  return [...logbook, ...trips, ...home, ...suggestions.entries, ...moving].sort(
    (a, b) => a.fromMs - b.fromMs || a.kind.localeCompare(b.kind)
  );
}
