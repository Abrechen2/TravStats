import type { RentalBooking, RentalInvoiceReading } from "../../types/rental";

/**
 * What an invoice would change on the rental it belongs to, one part at a
 * time (forgejo#237) — the rows of the review, where each is taken over on its
 * own. Mirrors the parts the server's import understands
 * (`RENTAL_INVOICE_PARTS`, backend/src/schemas/rentalImport.ts).
 *
 * A part the invoice does not carry is no row: there is nothing to take. A
 * part whose value the rental already holds is a row marked `same`, shown so
 * the reader sees it was checked, with nothing to tick.
 */
export type RentalInvoicePart =
  "finalAmount" | "vehicleDriven" | "odometer" | "distance" | "actualTimes";

export interface InvoiceDiffRow {
  part: RentalInvoicePart;
  /** What the rental holds now, as data the view words; null = nothing yet. */
  current: string | null;
  incoming: string;
  same: boolean;
}

interface Money {
  amount: number;
  currency: string;
}

export interface InvoiceDiffFormat {
  money: (m: Money) => string;
  km: (km: number) => string;
  time: (local: string) => string;
}

const pair = (a: string | null, b: string | null): string | null =>
  a === null && b === null ? null : `${a ?? "–"} → ${b ?? "–"}`;

/** `rental` null: the booking could not be read, so every row's current value is unknown. */
export function rentalInvoiceDiff(
  rental: RentalBooking | null,
  invoice: RentalInvoiceReading,
  fmt: InvoiceDiffFormat
): InvoiceDiffRow[] {
  const rows: InvoiceDiffRow[] = [];
  const push = (part: RentalInvoicePart, current: string | null, incoming: string | null): void => {
    if (incoming === null) return;
    rows.push({ part, current, incoming, same: current === incoming });
  };

  push(
    "finalAmount",
    rental?.finalAmount != null && rental.finalCurrency
      ? fmt.money({ amount: rental.finalAmount, currency: rental.finalCurrency })
      : null,
    invoice.finalAmount !== null && invoice.finalCurrency
      ? fmt.money({ amount: invoice.finalAmount, currency: invoice.finalCurrency })
      : null
  );
  push("vehicleDriven", rental?.vehicleDriven ?? null, invoice.vehicleDriven);
  const reading = (km: number | null): string | null => (km === null ? null : fmt.km(km));
  push(
    "odometer",
    rental ? pair(reading(rental.odometerOutKm), reading(rental.odometerInKm)) : null,
    pair(reading(invoice.odometerOutKm), reading(invoice.odometerInKm))
  );
  push(
    "distance",
    rental?.distanceKm != null ? fmt.km(rental.distanceKm) : null,
    invoice.distanceKm === null ? null : fmt.km(invoice.distanceKm)
  );
  const wall = (v: { local: string } | null | undefined): string | null =>
    v ? fmt.time(v.local.slice(0, 16)) : null;
  push(
    "actualTimes",
    rental ? pair(wall(rental.times.actualPickup), wall(rental.times.actualReturn)) : null,
    pair(
      invoice.actualPickupLocal ? fmt.time(invoice.actualPickupLocal) : null,
      invoice.actualReturnLocal ? fmt.time(invoice.actualReturnLocal) : null
    )
  );
  return rows;
}

/**
 * The booked → invoiced difference the review names first: the sum of every
 * new fee, since the readers do not take an invoice's fee lines apart. Same
 * currency only; null otherwise.
 */
export function invoiceDifference(
  rental: Pick<RentalBooking, "price" | "currency"> | null,
  invoice: Pick<RentalInvoiceReading, "finalAmount" | "finalCurrency">
): Money | null {
  if (!rental || rental.price === null || invoice.finalAmount === null) return null;
  if (!rental.currency || rental.currency !== invoice.finalCurrency) return null;
  return {
    amount: Math.round((invoice.finalAmount - rental.price) * 100) / 100,
    currency: rental.currency,
  };
}
