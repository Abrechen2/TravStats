/**
 * Does a typed wall clock exist at a place, once or twice? (ADR 0002, D3/Q5.)
 *
 * MIRRORED in meaning at backend/src/shared/time/instant.ts, which is the
 * authority: the server refuses a typed time in a DST gap
 * (`LOCAL_TIME_NONEXISTENT`) and takes the earlier occurrence of a repeated
 * hour unless the client sends `fold: "later"`. The web asks the same question
 * BEFORE saving only so a form can say so next to the field and offer the
 * later occurrence — it never turns the wall clock into an instant itself.
 */
import { wallClockPartsOrNull } from "./zone";

/** `ok` — exists once; `gap` — skipped by a clock change; `repeated` — exists twice. */
export type WallClockKind = "ok" | "gap" | "repeated";

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

function offsetAt(instantMs: number, zone: string): number | null {
  const parts = wallClockPartsOrNull(new Date(instantMs), zone);
  if (!parts) return null;
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Classifies `local` (`YYYY-MM-DDTHH:mm[:ss]`) in `zone`. Null for a string
 * that is not a wall clock or a zone the runtime does not know — the caller
 * then says nothing and leaves the verdict to the server.
 *
 * Every candidate instant is `wall − offset` for one of the offsets in force
 * a day either side; a wall clock that none of them reproduces is in a gap,
 * one that two of them reproduce is repeated. No zone changes its offset
 * twice within 48 hours, so the two probes see every offset that can apply.
 */
export function classifyWallClock(local: string, zone: string): WallClockKind | null {
  const match = LOCAL.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const wall = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0)
  );
  if (Number.isNaN(wall)) return null;
  const before = offsetAt(wall - DAY_MS, zone);
  const after = offsetAt(wall + DAY_MS, zone);
  if (before === null || after === null) return null;
  const matches = new Set<number>();
  for (const offset of new Set([before, after])) {
    const candidate = wall - offset;
    if (offsetAt(candidate, zone) === offset) matches.add(candidate);
  }
  if (matches.size === 0) return "gap";
  return matches.size > 1 ? "repeated" : "ok";
}

/**
 * Which occurrence of a repeated hour a stored instant is: `"later"` when
 * `local` exists twice in `zone` and `instant` is the second one, else
 * undefined. A form that only keeps the wall clock reads this back so an
 * edit that does not touch the time resends the occurrence that was stored
 * instead of silently falling back to the earlier one (Q5).
 */
export function storedFold(
  local: string,
  zone: string,
  instant: string | null | undefined
): "later" | undefined {
  if (!instant || classifyWallClock(local, zone) !== "repeated") return undefined;
  const match = LOCAL.exec(local);
  const ms = Date.parse(instant);
  if (!match || Number.isNaN(ms)) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  const wall = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0)
  );
  const before = offsetAt(wall - DAY_MS, zone);
  const after = offsetAt(wall + DAY_MS, zone);
  if (before === null || after === null) return undefined;
  // The later occurrence is read with the smaller offset (the clock went back).
  return ms === wall - Math.min(before, after) ? "later" : undefined;
}
