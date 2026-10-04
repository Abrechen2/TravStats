import type { SummaryFigure } from "../../components/table/ListSummaryStrip";
import type { RentalListSummary } from "../api/rental";

/**
 * The numbers above the rental table (forgejo#197) — the strip every logbook
 * carries, and the same promise (`ListSummaryStrip`): it describes the whole
 * filtered list, nothing estimated. The list is server-paged, so the counting
 * happens on the server (`backend/src/shared/listSummary.ts`); this only
 * formats what it sent. Counted here from the rows on screen, it described one
 * page and called it the logbook.
 *
 * Days count only rentals that were not cancelled: a cancelled booking's span
 * is days nobody had the car. Kilometres are left out like rail's distance —
 * most rows wait for an invoice, and a total over the few that have one would
 * read as the whole.
 */
export function rentalSummaryFigures(
  summary: RentalListSummary,
  labels: {
    rentals: (count: number) => string;
    days: (count: number) => string;
    providers: (count: number) => string;
  }
): SummaryFigure[] {
  return [
    { key: "rentals", value: String(summary.rentals), label: labels.rentals(summary.rentals) },
    { key: "days", value: String(summary.days), label: labels.days(summary.days) },
    {
      key: "providers",
      value: String(summary.providers),
      label: labels.providers(summary.providers),
    },
  ];
}
