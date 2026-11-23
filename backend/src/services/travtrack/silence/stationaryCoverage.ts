import { prisma } from "../../../db";
import { logbookWindows } from "../../locationEvidence/journeys/entryWindows";
import { inPrivacyZone } from "../classify";
import type { CoveragePiece } from "../dayEntryCoverage";
import { foldContextFor, HOME_ID } from "../places/places";
import { privacyCircleSet, privacyCirclesFor } from "../privacyCircles";
import type { Span } from "../readSafe";
import { KNOWN_PLACE_M, knownNear } from "../stopPlaces/identity";
import {
  judgeSilence,
  usableEnd,
  type SilenceEnd,
  type StationaryPlace,
  type UnexplainedReason,
} from "./stationary";

/**
 * Applies the stationary explanation to a day's coverage (see `stationary.ts`): every
 * `noData` piece whose neighbours are recorded time (or the window's edge) is judged by the
 * last good fix before it and the first good fix after it — which may lie days away, a quiet
 * weekend at home having no point on the day at all.
 *
 * A piece becomes `stationary` (with the place) only when both ends are in one known place and
 * nothing contradicts it: no logbook entry, no reported pause, no deleted span between the ends.
 * Otherwise it stays `noData` and says why.
 */

/** How many stored fixes are looked through for a usable end (privacy-zone and bad fixes are skipped). */
const END_SCAN = 200;

export type StationaryPiece = CoveragePiece & {
  place?: { id: string; kind: StationaryPlace["kind"]; name: string; lat: number; lon: number };
  /** On a `noData` piece: why it was not explained. */
  why?: UnexplainedReason;
};

/** A spot that looks like home but is not known as one, offered to the owner as "Ist das dein Zuhause?". */
export type HomeSuggestion = { lat: number; lon: number; fromMs: number; untilMs: number };

export type StationaryResult = {
  coverage: StationaryPiece[];
  homeSuggestion: HomeSuggestion | null;
};

/** Both ends this close without any known place around: worth asking whether it is home. */
const SUGGEST_RADIUS_M = 200;

async function endNear(
  userId: string,
  atMs: number,
  direction: "before" | "after"
): Promise<SilenceEnd | null> {
  const rows = await prisma.travTrackPoint.findMany({
    where:
      direction === "before"
        ? { userId, t: { lte: new Date(atMs) } }
        : { userId, t: { gte: new Date(atMs) } },
    orderBy: [{ t: direction === "before" ? "desc" : "asc" }, { seq: "asc" }],
    take: END_SCAN,
    select: { t: true, lat: true, lon: true, accuracyM: true },
  });
  if (rows.length === 0) return null;
  // Each fix is judged by the circles in force for a line starting at it, as the day view does.
  const circlesAt = await privacyCircleSet(userId);
  const hit = rows.find((r) => usableEnd(r, circlesAt(r.t.getTime())));
  return hit ? { tMs: hit.t.getTime(), lat: hit.lat, lon: hit.lon } : null;
}

/** A logbook entry, a reported pause or a deleted span inside the silence contradicts "stood still". */
export async function interrupted(userId: string, span: Span): Promise<boolean> {
  const [entries, gaps, deleted, deletedPoints, between] = await Promise.all([
    logbookWindows(userId, span),
    prisma.travTrackGap.count({
      where: {
        userId,
        fromAt: { lt: new Date(span.untilMs) },
        toAt: { gt: new Date(span.fromMs) },
      },
    }),
    prisma.travTrackDeletedRange.count({
      where: {
        userId,
        fromAt: { lt: new Date(span.untilMs) },
        toAt: { gt: new Date(span.fromMs) },
      },
    }),
    // A point deleted on its own leaves a silence that must never be bridged (`readSafe`).
    prisma.travTrackDeletedPoint.count({
      where: {
        userId,
        tS: { gt: Math.floor(span.fromMs / 1000), lt: Math.ceil(span.untilMs / 1000) },
      },
    }),
    // Any stored fix strictly between the ends (an isolated fix elsewhere, a hidden one) is no silence.
    prisma.travTrackPoint.count({
      where: { userId, t: { gt: new Date(span.fromMs), lt: new Date(span.untilMs) } },
    }),
  ]);
  return (
    deletedPoints + between > 0 ||
    entries.some((e) => e.untilMs > span.fromMs && e.fromMs < span.untilMs) ||
    gaps + deleted > 0
  );
}

/** The known places a silence can be explained by: fixed places without a window, accepted stay places. */
export async function placesFor(
  userId: string,
  window: Span,
  day: string,
  ends: readonly SilenceEnd[]
): Promise<{ places: StationaryPlace[]; homeKnown: boolean }> {
  const fold = await foldContextFor(userId, window, day);
  // A place with a time window only holds inside it; a silence has no clock to check it against.
  const fixed = fold.places
    .filter((p) => p.window === null)
    .map((p): StationaryPlace => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      lat: p.lat,
      lon: p.lon,
      radiusM: p.radiusM,
    }));
  const known = (await Promise.all(ends.map((e) => knownNear(userId, e)))).flat();
  const stays = known
    .filter((k) => k.kind === "place" && k.placeId !== undefined)
    .map((k): StationaryPlace => ({
      id: `place:${k.placeId}`,
      name: k.name,
      kind: "place",
      lat: k.lat,
      lon: k.lon,
      radiusM: KNOWN_PLACE_M,
    }));
  // A place inside a privacy circle is never named, drawn or used to explain anything.
  const circles = await privacyCirclesFor(userId, window.fromMs);
  const visible = [...fixed, ...stays].filter((p) => !inPrivacyZone(p, circles));
  return { places: visible, homeKnown: fold.places.some((p) => p.id === HOME_ID) };
}

export async function explainStationary(
  userId: string,
  window: Span,
  day: string,
  coverage: readonly CoveragePiece[]
): Promise<StationaryResult> {
  const out: StationaryPiece[] = coverage.map((c) => ({ ...c }));
  let homeSuggestion: HomeSuggestion | null = null;
  for (let i = 0; i < out.length; i++) {
    const piece = out[i];
    if (piece.state !== "noData") continue;
    // The ends of a silence are fixes; next to a pause, a deletion or an entry they are not.
    const [prev, next] = [out[i - 1], out[i + 1]];
    if ((prev && prev.state !== "recorded") || (next && next.state !== "recorded")) {
      piece.why = "contradicted";
      continue;
    }
    const [before, after] = await Promise.all([
      endNear(userId, piece.fromMs, "before"),
      endNear(userId, piece.untilMs, "after"),
    ]);
    if (!before || !after) {
      piece.why = "openEnd";
      continue;
    }
    const span = { fromMs: before.tMs, untilMs: after.tMs };
    if (await interrupted(userId, span)) {
      piece.why = "contradicted";
      continue;
    }
    const { places, homeKnown } = await placesFor(userId, window, day, [before, after]);
    const verdict = judgeSilence(before, after, places);
    if (verdict.kind === "stationary") {
      const { id, kind, name, lat, lon } = verdict.place;
      piece.state = "stationary";
      piece.place = { id, kind, name, lat, lon };
      continue;
    }
    piece.why = verdict.reason;
    const apartM = Math.hypot(
      (before.lat - after.lat) * 111_000,
      (before.lon - after.lon) * 111_000 * Math.cos((before.lat * Math.PI) / 180)
    );
    if (!homeKnown && verdict.reason === "outsidePlaces" && apartM <= SUGGEST_RADIUS_M) {
      homeSuggestion ??= {
        lat: after.lat,
        lon: after.lon,
        fromMs: piece.fromMs,
        untilMs: piece.untilMs,
      };
    }
  }
  return { coverage: out, homeSuggestion };
}
