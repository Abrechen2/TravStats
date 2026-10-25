/**
 * What a journey question stores, and the part of it the owner's inbox sees
 * (TravTrack plan E7).
 *
 * Stored (`location_suggestions.evidence`, server-side): per run its times,
 * distance, both ends, the privacy-cut line, the speed hint, the point digests
 * (E5 finds a run by them when its points are deleted) and what the user
 * answered for it. Shown (`publicJourney`): times, distance, ends, hint and
 * answer — never a digest and never the line. Ends and lines are for the
 * owner's inbox only: no share, export, public link, comparison or federation
 * payload reads this table.
 */
import { z } from "../../../schemas/zod";
import type { LonLat } from "../../travtrack/privacyCut";

/** The entries a journey run can be answered with: the forms the card opens. */
export const JOURNEY_ENTRY_KINDS = ["rail", "bus", "roadtrip"] as const;
export type JourneyEntryKind = (typeof JOURNEY_ENTRY_KINDS)[number];

/**
 * `open` — not answered; `linked` — answered with an entry; `closed` — the
 * user said it needs none; `invalidated` — its history no longer holds it.
 */
export const RUN_STATES = ["open", "linked", "closed", "invalidated"] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Digests a run keeps: the first and the last always among them. */
export const RUN_DIGEST_CAP = 20_000;

const position = z.object({ lat: z.number(), lon: z.number() });
const lonLat = z.tuple([z.number(), z.number()]);

const storedRun = z.object({
  fromMs: z.number().int(),
  untilMs: z.number().int(),
  km: z.number(),
  start: position,
  end: position,
  startRecorded: z.boolean(),
  endRecorded: z.boolean(),
  startZone: z.string(),
  endZone: z.string(),
  line: z.array(z.array(lonLat)),
  modeHint: z.enum(["rail", "road", "unknown"]),
  pointCount: z.number().int(),
  pointDigests: z.array(z.string()),
  state: z.enum(RUN_STATES),
  link: z.object({ entryKind: z.enum(JOURNEY_ENTRY_KINDS), entryId: z.string() }).nullable(),
});

const journeyEvidence = z.object({
  source: z.literal("travtrack"),
  /** The local day the question is about, `YYYY-MM-DD`. */
  day: z.string(),
  /** The zone that day is named in. */
  zone: z.string(),
  readCoverage: z.enum(["complete", "truncated", "unreachable"]),
  runs: z.array(storedRun).min(1),
});

export type StoredJourneyRun = z.infer<typeof storedRun> & { line: LonLat[][] };
export type JourneyEvidence = z.infer<typeof journeyEvidence>;

/** A stored journey's evidence, or null when the row holds something else. */
export function parseJourneyEvidence(value: unknown): JourneyEvidence | null {
  const parsed = journeyEvidence.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** At most `RUN_DIGEST_CAP` digests, first and last kept. */
export function capDigests(digests: readonly string[]): string[] {
  if (digests.length <= RUN_DIGEST_CAP) return [...digests];
  return [...digests.slice(0, RUN_DIGEST_CAP - 1), digests[digests.length - 1]];
}

/** Every entry this question was answered with, as `kind:id` (`entryRef`). */
export function linkedRefs(evidence: JourneyEvidence | null): Set<string> {
  return new Set(
    (evidence?.runs ?? []).flatMap((r) => (r.link ? [`${r.link.entryKind}:${r.link.entryId}`] : []))
  );
}

export type PublicJourneyRun = {
  index: number;
  fromMs: number;
  untilMs: number;
  km: number;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  startRecorded: boolean;
  endRecorded: boolean;
  startZone: string;
  endZone: string;
  modeHint: "rail" | "road" | "unknown";
  state: RunState;
  link: { entryKind: JourneyEntryKind; entryId: string } | null;
};

export type PublicJourney = { day: string; zone: string; runs: PublicJourneyRun[] };

/** What the owner's inbox reads of a journey question: no digest, no line. */
export function publicJourney(evidence: JourneyEvidence): PublicJourney {
  return {
    day: evidence.day,
    zone: evidence.zone,
    runs: evidence.runs.map((r, index) => ({
      index,
      fromMs: r.fromMs,
      untilMs: r.untilMs,
      km: Math.round(r.km * 10) / 10,
      start: r.start,
      end: r.end,
      startRecorded: r.startRecorded,
      endRecorded: r.endRecorded,
      startZone: r.startZone,
      endZone: r.endZone,
      modeHint: r.modeHint,
      state: r.state,
      link: r.link,
    })),
  };
}

/** Every run is answered — linked, closed or invalidated. */
export const allAnswered = (e: JourneyEvidence) => e.runs.every((r) => r.state !== "open");
