/**
 * The home place as one record (plan `2026-11-01-home-one-source`, phase S1).
 *
 * The residence of the CURRENT home period (`utils/homeAirport.ts`) is the
 * home place. `user_settings.home_place` is only a fallback for an account
 * with no current period carrying a residence (and the Companion's old upload
 * target); it never wins over a period.
 */
import { homePlaceSchema, type HomePlace } from "../../schemas/companionData";
import { zoneOf } from "../../shared/time/zoneOf";
import { currentPeriod, type HomePeriod } from "../../utils/homeAirport";
import logger from "../../utils/logger";
import { homePeriodsFromData } from "./homeStore";

/**
 * Read leniently on purpose: a stored home missing its name or zone must still
 * keep a shared route away from its position (`shareNarrow`), never let it through.
 */
const legacyHomeSchema = homePlaceSchema.partial({ name: true, zone: true });

export type HomePlaceSource = "period" | "legacy";

export interface DerivedHomePlace {
  homePlace: HomePlace | null;
  homePlaceSource: HomePlaceSource;
}

/** The zone of a residence, or null: a zone that cannot be looked up is abstention, not a reason to hide the home. */
function residenceZone(lat: number, lon: number): string | null {
  try {
    return zoneOf({ lat, lon });
  } catch (error) {
    logger.warn({
      operation: "home_place_zone",
      message: "Zone of the residence unresolved",
      error,
    });
    return null;
  }
}

/** The home place a settings row holds: the current period's residence, else the legacy column. */
export async function deriveHomePlace(
  row: { data?: unknown; homePlace?: unknown } | null | undefined
): Promise<DerivedHomePlace> {
  const periods = await homePeriodsFromData(row?.data);
  const residence = currentPeriod(periods)?.residence;
  if (residence) {
    return {
      homePlace: {
        name: residence.name,
        lat: residence.lat,
        lon: residence.lon,
        zone: residenceZone(residence.lat, residence.lon),
      },
      homePlaceSource: "period",
    };
  }
  const legacy = legacyHomeSchema.safeParse(row?.homePlace);
  return {
    homePlace: legacy.success
      ? { ...legacy.data, name: legacy.data.name ?? "", zone: legacy.data.zone ?? null }
      : null,
    homePlaceSource: "legacy",
  };
}

/** `periods` with the current period's residence replaced; null when there is no current period. */
export function withCurrentResidence(
  periods: readonly HomePeriod[],
  place: Pick<HomePlace, "name" | "lat" | "lon">
): HomePeriod[] | null {
  const current = currentPeriod(periods);
  if (!current) return null;
  const same = current.residence?.lat === place.lat && current.residence?.lon === place.lon;
  return periods.map((p) =>
    p === current
      ? {
          ...p,
          residence: {
            name: place.name,
            lat: place.lat,
            lon: place.lon,
            placeRef: same ? (current.residence?.placeRef ?? null) : null,
          },
          residenceConfirmed: true,
        }
      : p
  );
}
