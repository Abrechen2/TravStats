import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { loadWrappedChapterRows } from "../stats/wrappedDomains";
import {
  buildWrappedChapters,
  type WrappedChapterRows,
  type WrappedChapters,
} from "../stats/wrappedChapters";
import type { PagingParams } from "./paging";
import { domainSumEvidence } from "./domainMeasureResponse";

/**
 * The year in review's chapter cards (forgejo#265): stays, places, roadtrips,
 * day tours, rentals and bus rides. Each panel lists the very rows the chapter
 * counted — the loader (`loadWrappedChapterRows`) files them by their domain's
 * own rule and attaches the entry each row stands for — and its value is the
 * chapter's own figure (`buildWrappedChapters`), so a card and its panel are
 * one computation. A hidden domain has no chapter and answers no figure.
 *
 * The year in review is always ONE year, so the scope is `year` only.
 */
type Chapter = keyof WrappedChapterRows & keyof WrappedChapters;

function readYear(scope: EvidenceScope, key: string): number {
  if (scope.period.kind !== "year") {
    throw new AppError(`${key} evidence supports period=year only.`, 400);
  }
  return scope.period.year;
}

function chapterCount(
  key: string,
  unit: string,
  chapter: Chapter,
  figure: (chapters: WrappedChapters) => number | null
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const year = readYear(scope, key);
    const rows = await loadWrappedChapterRows(userId);
    const list = (rows[chapter] ?? []) as Array<{ year: number; entry?: EvidenceEntry }>;
    const entries = list
      .filter((r) => r.year === year && r.entry !== undefined)
      .map((r) => ({ ...(r.entry as EvidenceEntry), contribution: 1 }));
    const value = figure(buildWrappedChapters(rows, year));
    return domainSumEvidence({ key, unit, scope, page, entries, value });
  };
}

export const WRAPPED_RESOLVERS = {
  wrappedStayCount: chapterCount(
    "wrappedStayCount",
    "stays",
    "lodging",
    (c) => c.lodging?.stays ?? null
  ),
  wrappedPlaceVisitCount: chapterCount(
    "wrappedPlaceVisitCount",
    "visits",
    "places",
    (c) => c.places?.visits ?? null
  ),
  wrappedRoadtripCount: chapterCount(
    "wrappedRoadtripCount",
    "roadtrips",
    "roadtrips",
    (c) => c.roadtrips?.roadtrips ?? null
  ),
  wrappedTourCount: chapterCount(
    "wrappedTourCount",
    "tours",
    "tours",
    (c) => c.tours?.tours ?? null
  ),
  wrappedRentalCount: chapterCount(
    "wrappedRentalCount",
    "rentals",
    "rentals",
    (c) => c.rentals?.rentals ?? null
  ),
  wrappedBusRideCount: chapterCount(
    "wrappedBusRideCount",
    "rides",
    "bus",
    (c) => c.bus?.rides ?? null
  ),
};
