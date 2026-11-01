/**
 * `GET /stats/cross-domain` — cheap cross-domain statistics derived from data
 * the logbook already holds (forgejo#399, from the forgejo#388 audit §3.1).
 *
 * Every block is independent and additive: it is computed on its own, a block
 * that cannot be derived is `null` (abstention, never zero), and a block whose
 * LOAD failed is `null` too but is named in `unavailable` — a failure reaches
 * the client as itself instead of as an empty card. Rules live beside the
 * pure functions in `utils/stats/crossDomain/`; this file only gathers rows.
 */
import logger from "../../../utils/logger";
import { loadVisibleDomainSet } from "../../domainVisibility";
import { loadCrossDomainPopulation } from "../../evidence/crossDomainPopulations";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { todayIn, now as clockNow } from "../../../shared/time/clock";
import type { DomainKey } from "../../../shared/domains";
import { computeStreaks } from "../../../utils/stats/crossDomain/streaks";
import { computeRhythm } from "../../../utils/stats/crossDomain/rhythm";
import { computeTimeShift } from "../../../utils/stats/crossDomain/timeShift";
import { computeUnseen } from "../../../utils/stats/crossDomain/lastVisit";
import { computeSchengen } from "../../../utils/stats/crossDomain/schengen";
import { computePricePerKm } from "../../../utils/stats/crossDomain/pricePerKm";
import { computePhotoStats } from "../../../utils/stats/crossDomain/photoStats";
import { loadTravelAccountData } from "../travelAccountData";
import { loadPresence, type PresenceData } from "./presenceLoader";
import { loadNightsByCountry, loadPricedRides } from "./spendNightsLoader";
import { loadPhotoFacts } from "./photoLoader";

export type CrossDomainBlock =
  | "streaks"
  | "rhythm"
  | "timeShift"
  | "unseen"
  | "pricePerKm"
  | "nightsByCountry"
  | "schengen"
  | "photos";

/** Runs one block's load; a throw becomes `null` plus a name in `failed`, and a log line. */
async function guarded<T>(
  name: CrossDomainBlock,
  failed: CrossDomainBlock[],
  run: () => Promise<T | null>
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    logger.error({ operation: "cross_domain_stats_block_failed", block: name, error });
    failed.push(name);
    return null;
  }
}

export async function loadCrossDomainStats(userId: string) {
  const now = clockNow();
  const zone = (await profileZoneOf(userId)).zone;
  const today = todayIn(zone);
  const visible = await loadVisibleDomainSet(userId);
  const domains = [...visible] as DomainKey[];
  const failed: CrossDomainBlock[] = [];

  let presenceShared: Promise<PresenceData> | null = null;
  const presence = (): Promise<PresenceData> =>
    (presenceShared ??= loadPresence(userId, visible, now, today));

  const [streaksAndRhythm, timeShift, unseen, pricePerKm, nightsByCountry, schengen, photos] =
    await Promise.all([
      guarded("streaks", failed, async () => {
        const { events } = await loadCrossDomainPopulation(userId, domains);
        const byDomain: Record<string, string[]> = {};
        for (const e of events) (byDomain[e.domain] ??= []).push(...e.dayKeys);
        const all = Object.values(byDomain).flat();
        return {
          streaks: computeStreaks(all, today),
          rhythm: computeRhythm(byDomain, today),
        };
      }),
      guarded("timeShift", failed, async () => computeTimeShift((await presence()).shiftFlights)),
      guarded("unseen", failed, async () => {
        const unseenLists = computeUnseen((await presence()).sightings, today);
        const any = Object.values(unseenLists).some((l) => l !== null);
        return any ? unseenLists : null;
      }),
      guarded("pricePerKm", failed, async () =>
        computePricePerKm(await loadPricedRides(userId, visible))
      ),
      guarded("nightsByCountry", failed, async () =>
        loadNightsByCountry(await loadTravelAccountData(userId, visible), now)
      ),
      guarded("schengen", failed, async () => computeSchengen((await presence()).presence, today)),
      guarded("photos", failed, async () => computePhotoStats(await loadPhotoFacts(userId, zone))),
    ]);

  return {
    asOf: today,
    streaks: streaksAndRhythm?.streaks ?? null,
    rhythm: streaksAndRhythm?.rhythm ?? null,
    timeShift,
    unseen,
    pricePerKm,
    nightsByCountry,
    schengen,
    photos,
    // One load feeds both blocks, so one failure takes both.
    unavailable: [
      ...new Set(failed.flatMap((b) => (b === "streaks" ? [b, "rhythm" as const] : [b]))),
    ],
  };
}
