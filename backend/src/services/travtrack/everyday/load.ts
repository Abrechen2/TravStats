import { flightWindowsIn } from "../../locationEvidence/derivationRead";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { localDayReader } from "../../tripRecording/localDays";
import { groundKm, inFlightBy } from "../months/values";
import { readSafeTravTrack, type SafeCursor, type Span } from "../readSafe";
import { addStretches, emptyFigures, type EverydayFigures } from "./fold";

/**
 * The everyday figures of one window of an account's TravTrack history
 * (forgejo#400), read page by page through the privacy-safe read
 * (`readSafe.ts`): what a privacy zone hides, a deleted span removed or a
 * reported pause cut is not in any figure. The ground kilometres are the
 * monthly values' own counting (`groundKm`, one home); days are the account's
 * profile-zone calendar days on which a safe fix exists.
 *
 * Null — abstention, never zeros — when the window holds no safe fix, or is
 * larger than `MAX_PAGES` pages (a figure over part of a year passed off as
 * the year's is worse than none). A page boundary ends each stretch, so the
 * one step across it is not counted: an undercount of a step, never a hidden
 * one.
 */

export const PAGE_SIZE = 50_000;
export const MAX_PAGES = 60;

export type EverydaySummary = {
  figures: EverydayFigures;
  kmGround: number;
  /** Profile-zone calendar days with at least one privacy-safe fix. */
  days: number;
  fixes: number;
};

export async function loadEverydaySummary(
  userId: string,
  window: Span,
  pageSize: number = PAGE_SIZE
): Promise<EverydaySummary | null> {
  const [flights, { zone }] = await Promise.all([
    flightWindowsIn(userId, window),
    profileZoneOf(userId),
  ]);
  const dayOf = localDayReader(zone);
  const days = new Set<string>();
  let figures = emptyFigures();
  let kmGround = 0;
  let fixes = 0;
  let cursor: SafeCursor | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const read = await readSafeTravTrack(userId, window, pageSize, cursor);
    const inFlight = inFlightBy(flights, (p) => read.rowOf(p)?.purpose === "flight");
    figures = addStretches(figures, read.segments, read.rowOf, inFlight);
    kmGround += groundKm(read.segments, inFlight);
    for (const stretch of read.segments) {
      for (const p of stretch) {
        days.add(dayOf(p[0]));
        fixes += 1;
      }
    }
    if (!read.next || !read.cursor) {
      return fixes === 0 ? null : { figures, kmGround, days: days.size, fixes };
    }
    cursor = read.cursor;
  }
  return null;
}
