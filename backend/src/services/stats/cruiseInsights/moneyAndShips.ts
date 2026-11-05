/**
 * Cruise money and ship profile (ledger stats-unused-data-opportunities,
 * points 2-3). Pure.
 *
 * ## Money
 *
 * Every figure is in the account's CURRENT base currency and reads a cruise's
 * amount through `cruiseBaseAmount` — the rule `totalSpendBase` and the
 * evidence panel share, so the numbers here cannot disagree with the tile.
 * A cruise whose price cannot reach the base currency (a foreign price with no
 * snapshot in today's base) is counted in `excluded`, never added across
 * currencies. A cruise with NO recorded price is `unknownPrice`; a recorded 0
 * IS a price (`isPricedCruise`, SRV-STATS-ZERO-PRICE-001) and adds nothing.
 *
 * Cost per sea day divides the money of cruises that HAVE a sea day by those
 * sea days; a cruise without one is left out of both sides, so a river cruise
 * does not dilute the figure with a zero denominator.
 *
 * ## Ships
 *
 * Read from the catalogue ship only. Each figure says how many of the sailed
 * cruises it could be read on, so a catalogue with holes never silently
 * becomes an average over the lucky few. The age is the cruise's start year
 * minus the ship's build year; a cruise dated before the ship's build year is
 * an inconsistency and is left out of the average, not clamped to 0.
 */

import { cruiseBaseAmount, isPricedCruise } from "../cruiseSpendBase";
import { cruiseDays } from "./dayPattern";
import type { CruiseFacts, CruiseInsightRow } from "./rows";

export interface Ref {
  id: string;
  label: string;
  startDate: string | null;
}

const refOf = (row: CruiseInsightRow): Ref => ({
  id: row.id,
  label: row.label,
  startDate: row.startDay,
});

/** Money is rounded to the minor unit once, at the end. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface CruiseMoney {
  currency: string;
  /** Sailed cruises in scope. */
  cruises: number;
  /** Cruises with no recorded price. */
  unknownPrice: number;
  /** Priced cruises that could not be expressed in `currency`. */
  excluded: number;
  /** Cruises the figures below are read on. */
  counted: number;
  total: number | null;
  perSeaDay: { amount: number; seaDays: number; cruises: Ref[] } | null;
  mostExpensive: { cruise: Ref; amount: number } | null;
  perLine: Array<{ line: string; total: number; cruises: Ref[] }>;
}

export function foldCruiseMoney(
  rows: readonly CruiseInsightRow[],
  facts: ReadonlyMap<string, CruiseFacts>,
  baseCurrency: string
): CruiseMoney {
  let unknownPrice = 0;
  let excluded = 0;
  const counted: Array<{ row: CruiseInsightRow; amount: number; line: string | null }> = [];
  for (const row of rows) {
    const f = facts.get(row.id);
    if (!f || !isPricedCruise(f)) {
      unknownPrice += 1;
      continue;
    }
    const amount = cruiseBaseAmount(f, baseCurrency);
    if (amount === null) excluded += 1;
    else counted.push({ row, amount, line: f.cruiseLine?.trim() || null });
  }

  let seaMoney = 0;
  let seaDays = 0;
  const seaCruises: Ref[] = [];
  for (const { row, amount } of counted) {
    const days = cruiseDays(row).seaDays;
    if (days <= 0) continue;
    seaMoney += amount;
    seaDays += days;
    seaCruises.push(refOf(row));
  }

  let top: (typeof counted)[number] | null = null;
  for (const c of counted) {
    if (
      top === null ||
      c.amount > top.amount ||
      (c.amount === top.amount && c.row.id.localeCompare(top.row.id) < 0)
    )
      top = c;
  }

  const lines = new Map<string, { total: number; cruises: Ref[] }>();
  for (const { row, amount, line } of counted) {
    if (line === null) continue;
    const cur = lines.get(line) ?? { total: 0, cruises: [] };
    lines.set(line, { total: cur.total + amount, cruises: [...cur.cruises, refOf(row)] });
  }

  const total = counted.reduce((sum, c) => sum + c.amount, 0);
  return {
    currency: baseCurrency,
    cruises: rows.length,
    unknownPrice,
    excluded,
    counted: counted.length,
    total: counted.length > 0 ? round2(total) : null,
    perSeaDay:
      seaDays > 0 ? { amount: round2(seaMoney / seaDays), seaDays, cruises: seaCruises } : null,
    mostExpensive: top ? { cruise: refOf(top.row), amount: round2(top.amount) } : null,
    perLine: [...lines.entries()]
      .map(([line, v]) => ({ line, total: round2(v.total), cruises: v.cruises }))
      .sort((a, b) => b.total - a.total || a.line.localeCompare(b.line)),
  };
}

export interface ShipProfile {
  /** Sailed cruises in scope. */
  cruises: number;
  biggest: {
    shipName: string;
    grossTonnage: number;
    capacity: number | null;
    yearBuilt: number | null;
    cruises: Ref[];
  } | null;
  /** Cruises whose ship has a gross tonnage — "aus n von m". */
  tonnageKnown: number;
  averageAge: { years: number; cruises: Ref[] } | null;
  /** Cruises the average could be read on. */
  ageKnown: number;
}

export function foldShipProfile(
  rows: readonly CruiseInsightRow[],
  facts: ReadonlyMap<string, CruiseFacts>
): ShipProfile {
  const byShip = new Map<
    number,
    { f: NonNullable<CruiseFacts["ship"]>; rows: CruiseInsightRow[] }
  >();
  const ages: Array<{ row: CruiseInsightRow; age: number }> = [];
  let tonnageKnown = 0;
  for (const row of rows) {
    const ship = facts.get(row.id)?.ship ?? null;
    if (!ship) continue;
    if (ship.grossTonnage !== null) {
      tonnageKnown += 1;
      const cur = byShip.get(ship.id) ?? { f: ship, rows: [] };
      byShip.set(ship.id, { f: cur.f, rows: [...cur.rows, row] });
    }
    if (ship.yearBuilt !== null && row.year !== null && row.year >= ship.yearBuilt) {
      ages.push({ row, age: row.year - ship.yearBuilt });
    }
  }

  let best: { f: NonNullable<CruiseFacts["ship"]>; rows: CruiseInsightRow[] } | null = null;
  for (const entry of byShip.values()) {
    if (
      best === null ||
      entry.f.grossTonnage! > best.f.grossTonnage! ||
      (entry.f.grossTonnage === best.f.grossTonnage && entry.f.id < best.f.id)
    )
      best = entry;
  }

  return {
    cruises: rows.length,
    biggest: best
      ? {
          shipName: best.f.name,
          grossTonnage: best.f.grossTonnage!,
          capacity: best.f.capacity,
          yearBuilt: best.f.yearBuilt,
          cruises: best.rows.map(refOf),
        }
      : null,
    tonnageKnown,
    averageAge:
      ages.length > 0
        ? {
            years: Math.round((ages.reduce((s, a) => s + a.age, 0) / ages.length) * 10) / 10,
            cruises: ages.map((a) => refOf(a.row)),
          }
        : null,
    ageKnown: ages.length,
  };
}
