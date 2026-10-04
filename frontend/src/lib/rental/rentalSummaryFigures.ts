import type { SummaryFigure } from "../../components/table/ListSummaryStrip";
import type { RentalBooking } from "../../types/rental";

/**
 * The numbers above the rental table (forgejo#197), read off the rows on
 * screen — the strip every logbook carries, and the same promise
 * (`ListSummaryStrip`): it describes the list, nothing estimated.
 *
 * Days count only rentals that were not cancelled: a cancelled booking's span
 * is days nobody had the car. Kilometres are left out like rail's distance —
 * most rows wait for an invoice, and a total over the few that have one would
 * read as the whole.
 */
export function rentalSummaryFigures(
  rentals: readonly Pick<RentalBooking, "provider" | "rentalDays" | "status">[],
  labels: {
    rentals: (count: number) => string;
    days: (count: number) => string;
    providers: (count: number) => string;
  }
): SummaryFigure[] {
  const providers = new Set<string>();
  let days = 0;
  for (const rental of rentals) {
    const provider = rental.provider.trim();
    if (provider) providers.add(provider.toLocaleLowerCase());
    if (rental.status !== "cancelled") days += rental.rentalDays;
  }
  return [
    { key: "rentals", value: String(rentals.length), label: labels.rentals(rentals.length) },
    { key: "days", value: String(days), label: labels.days(days) },
    { key: "providers", value: String(providers.size), label: labels.providers(providers.size) },
  ];
}
