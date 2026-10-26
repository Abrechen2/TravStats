/**
 * Sending a month's dwell cells to the geocoder (TravTrack plan L3), after
 * the month's transaction — no network call holds the TravTrack lock — and so
 * with every condition asked again right before EACH request
 * (`lookUpCityCells`' `mayLookUp`):
 *
 *   - the account's city switch is still on;
 *   - TravTrack still may derive for it (instance on, provider TravTrack);
 *   - its history generation is still the one the month was read at — every
 *     removal and every zone created or grown raises it, so a cell whose
 *     history went, or that a new zone may cover, is never sent;
 *   - the cell's centre lies outside every privacy circle in force now.
 *
 * Any of them changed: the batch ends and nothing further leaves the server.
 *
 * A failed request (timeout, 408/429/5xx, network) backs the account off:
 * 15 minutes, doubling per consecutive failure up to a day, longer when the
 * geocoder's `Retry-After` asks for longer; an answer resets it. While backed
 * off, no cell of the account is sent at all. Each attempt starts one cell
 * further on, so a cell that keeps failing does not starve the ones behind it.
 */
import { prisma } from "../../../db";
import { travTrackDerivationAllowed } from "../../locationEvidence/allowed";
import { inPrivacyZone } from "../classify";
import { privacyCircleSet } from "../privacyCircles";
import { lookUpCityCells, rotated, type CityCell, type CityLookupDeps } from "./cities";
import { monthWindow } from "./window";
import { travTrackCityLookup } from "./read";

const BACKOFF_BASE_MS = 15 * 60_000;
const BACKOFF_MAX_MS = 24 * 60 * 60_000;

/** The wait after the `failures`-th consecutive failure. */
export const cityBackoffMs = (failures: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));

type LookupOptions = Pick<CityLookupDeps, "geocode" | "countryAt" | "max" | "intervalMs"> & {
  now: Date;
};

async function generationNow(userId: string): Promise<bigint> {
  const row = await prisma.travTrackDerivationState.findUnique({
    where: { userId },
    select: { historyGeneration: true },
  });
  return row?.historyGeneration ?? 0n;
}

/** Sends what may be sent of the month's missing cells; answers how many requests went. */
export async function lookUpMonthCities(
  userId: string,
  month: string,
  read: { missing: readonly CityCell[]; generation: bigint },
  opts: LookupOptions
): Promise<number> {
  const state = await prisma.travTrackDerivationState.findUnique({
    where: { userId },
    select: { cityLookupFailures: true, cityLookupRetryAfter: true },
  });
  if (state?.cityLookupRetryAfter && state.cityLookupRetryAfter > opts.now) return 0;
  const failures = state?.cityLookupFailures ?? 0;
  const fromMs = monthWindow(month).fromMs;

  const mayLookUp = async (cell: CityCell): Promise<boolean> => {
    if (!(await travTrackCityLookup(userId))) return false;
    if ((await travTrackDerivationAllowed(userId)) !== "ok") return false;
    if ((await generationNow(userId)) !== read.generation) return false;
    return !inPrivacyZone(cell, (await privacyCircleSet(userId))(fromMs));
  };

  const outcome = await lookUpCityCells(rotated(read.missing, failures), { ...opts, mayLookUp });
  if (outcome.failed) {
    const next = failures + 1;
    const waitMs = Math.max(cityBackoffMs(next), outcome.failed.retryAfterMs ?? 0);
    const data = {
      cityLookupFailures: next,
      cityLookupRetryAfter: new Date(opts.now.getTime() + waitMs),
    };
    await prisma.travTrackDerivationState.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  } else if (outcome.looked > 0 && failures > 0) {
    await prisma.travTrackDerivationState.update({
      where: { userId },
      data: { cityLookupFailures: 0, cityLookupRetryAfter: null },
    });
  }
  return outcome.looked;
}
