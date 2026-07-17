import { prisma } from "../db";
import logger from "../utils/logger";

/**
 * One-shot, idempotent backfill: bookings created priceless by earlier imports
 * whose >=2 flights all carry the identical non-null price and currency get
 * that total moved onto the booking; the segment prices are nulled (same rule
 * as the batch-import path — spec 2026-07-17-cost-booking-price). Safe to
 * re-run: healed bookings have price != null and are never matched again.
 */
export async function backfillBookingPrices(): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: { price: null },
    select: {
      id: true,
      flights: { select: { id: true, price: true, currency: true } },
    },
  });

  let healed = 0;
  for (const b of bookings) {
    if (b.flights.length < 2) continue;
    const firstPrice = b.flights[0].price;
    if (firstPrice == null) continue;
    const firstCurrency = b.flights[0].currency ?? "EUR";
    const identical = b.flights.every(
      (f) => f.price === firstPrice && (f.currency ?? "EUR") === firstCurrency
    );
    if (!identical) continue;

    await prisma.$transaction([
      prisma.booking.update({
        where: { id: b.id },
        data: { price: firstPrice, currency: firstCurrency },
      }),
      prisma.flight.updateMany({
        where: { id: { in: b.flights.map((f) => f.id) } },
        data: { price: null },
      }),
    ]);
    healed++;
  }

  if (healed > 0) {
    logger.info({ operation: "backfill_booking_prices_done", healed, scanned: bookings.length });
  }
  return healed;
}
