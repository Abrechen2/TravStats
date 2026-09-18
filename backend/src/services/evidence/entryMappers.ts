import type { EvidenceEntry } from "../../schemas/evidence";

/**
 * Row → `EvidenceEntry`, one function per domain. Split out of
 * `rankingEvidence.ts` because Task 6 (the remaining ranking dimensions) and
 * Task 7 (the metrics) both need the flight mapper again rather than each
 * re-deriving `href`/`title`/`subtitle` from a flight row its own way.
 */

/** The subset of `Flight` a flight entry needs to render itself. */
export interface FlightEvidenceRow {
  id: string;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  departureTime: Date | null;
}

/**
 * A flight as evidence. Unlike a lodging stay (`docs/.../evidence-panel-design.md`,
 * "Identity"), a flight's `href` targets the SAME row `id` names — there is no
 * separate parent it belongs to. `title` is the flight number and `subtitle`
 * the route, both `{ text }` because a flight number and an IATA pair are the
 * traveller's own data, not a phrase to translate (task-5-brief.md, "Decisions
 * already made").
 */
export function flightEvidenceEntry(row: FlightEvidenceRow, contribution: number): EvidenceEntry {
  return {
    domain: "flight",
    id: row.id,
    href: `/flights/${row.id}`,
    title: { text: row.flightNumber ?? "—" },
    subtitle: { text: `${row.depIata ?? "?"} → ${row.arrIata ?? "?"}` },
    // Day precision: a flight always has an actual calendar day even where
    // `historical`'s time-of-day is a placeholder (see
    // `shared/flightCounting.ts`'s split of "happened" from "clock is
    // trustworthy") — never flattened further than the contract allows.
    date: row.departureTime
      ? { value: row.departureTime.toISOString().slice(0, 10), precision: "day" }
      : null,
    contribution,
  };
}
