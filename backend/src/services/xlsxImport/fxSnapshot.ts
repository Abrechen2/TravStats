/**
 * FX snapshot recompute for the XLSX importer (fix round 1, finding 3).
 *
 * `importSheets.ts` writes `price`/`currency` for cruises and flights without
 * ever calling `fxColumnsFor` — an imported price EDIT left `priceBase` STALE,
 * pointing at the OLD price, which is worse than null because it still looks
 * like a valid conversion. Pulled out of `importSheets.ts` (not only for the
 * fix, but because that file was pushing the 800-line ratchet) so both models
 * share one place that decides "did an FX-relevant column actually change".
 *
 * A spreadsheet cell never explicitly CLEARS a value — an empty cell means
 * "not mentioned" (`cells.ts`) — so `undefined` here always means "read the
 * EXISTING row's value", never "erase it". That is what the merge below does.
 */

import { prisma } from "../../db";
import { fxColumnsFor, getBaseCurrency, flightOwnAmount, type FxColumns } from "../fx/snapshot";

interface Incoming {
  price: number | undefined;
  currency: string | undefined;
}

/** The row's own FX-merge inputs — pulled out of `importSheets.ts`'s `existing`
 *  lookup so that file does not carry the multi-field `select`. */
export function findCruiseForFxMerge(id: string, userId: string) {
  return prisma.cruise.findFirst({
    where: { id, userId },
    select: { id: true, price: true, currency: true, startDate: true },
  });
}

/** Recomputes a cruise's FX columns, or `{}` (leave untouched) when none of
 *  price/currency/startDate was actually mentioned in the row. */
export async function cruiseFxColumnsIfChanged(
  userId: string,
  incoming: Incoming & { startDate: Date | undefined },
  existing: { price: number | null; currency: string | null; startDate: Date | null }
): Promise<Partial<FxColumns>> {
  if (incoming.price === undefined && incoming.currency === undefined && !incoming.startDate) {
    return {};
  }
  return fxColumnsFor(
    {
      amount: incoming.price !== undefined ? incoming.price : existing.price,
      currency: incoming.currency !== undefined ? incoming.currency : existing.currency,
      date: incoming.startDate ?? existing.startDate,
    },
    await getBaseCurrency(userId)
  );
}

/** Recomputes a flight's FX columns for an UPDATE, merged against the
 *  existing row — `taxes`/`fees` are never edited by this importer (the
 *  sheet has no such columns), so they always come from `existing`. */
export async function flightFxColumnsIfChanged(
  userId: string,
  incoming: Incoming & { departureTime: Date | undefined },
  existing: {
    price: number | null;
    taxes: number | null;
    fees: number | null;
    currency: string | null;
    departureTime: Date | null;
  }
): Promise<Partial<FxColumns>> {
  if (incoming.price === undefined && incoming.currency === undefined && !incoming.departureTime) {
    return {};
  }
  return fxColumnsFor(
    {
      amount: flightOwnAmount({
        price: incoming.price !== undefined ? incoming.price : existing.price,
        taxes: existing.taxes,
        fees: existing.fees,
      }),
      currency: incoming.currency !== undefined ? incoming.currency : existing.currency,
      date: incoming.departureTime ?? existing.departureTime,
    },
    await getBaseCurrency(userId)
  );
}

/** A brand-new flight has no prior row to merge against — this is a missed
 *  conversion, not a stale one, but a flight created via the UI always gets
 *  one (`routes/flights.ts`), so an imported one should too. */
export async function flightFxColumnsForCreate(
  userId: string,
  incoming: Incoming & { departureTime: Date | undefined }
): Promise<FxColumns> {
  return fxColumnsFor(
    {
      amount: flightOwnAmount({ price: incoming.price, taxes: undefined, fees: undefined }),
      currency: incoming.currency,
      date: incoming.departureTime,
    },
    await getBaseCurrency(userId)
  );
}
