import { seedCuratedPlacesFromCSV } from "../seedCuratedPlacesFromCSV";
import { seedLodgingChainsFromCSV } from "../seedLodgingChainsFromCSV";
import { seedPortsFromCSV } from "../seedPortsFromCSV";
import { seedRailStations } from "../seedRailStations";
import { seedShipsFromCSV } from "../seedShipsFromCSV";
import { getInstanceSettings, updateInstanceSettings } from "../services/instanceSettingsService";
import logger from "../utils/logger";

/**
 * The two things the demo seed does to the INSTANCE rather than to the
 * account. Both run from the seed script only (`seedDemoAccount.ts` main),
 * never from `runDemoSeed`, so a test that seeds the account does not flip an
 * instance switch or load 60,000 stations as a side effect.
 */

/**
 * The catalogues the demo's rows point at. The server seeds them when it
 * starts; on a first boot the demo seed runs BEFORE the server — in the image
 * the entrypoint seeds it, in development `init.ts` does — and found empty
 * tables: Forgejo #2 was exactly this for cruises (no ports, "0 cruises").
 * Each seeder is idempotent and touches no user-added row, so the server's own
 * pass a few seconds later is a no-op. A failure is logged and the next one
 * tried: a demo without linked rail stations is still a demo.
 */
export async function ensureDemoCatalogues(): Promise<void> {
  const seeds: Array<[string, () => Promise<unknown>]> = [
    ["ports", seedPortsFromCSV],
    ["ships", seedShipsFromCSV],
    ["lodging_chains", seedLodgingChainsFromCSV],
    ["curated_places", seedCuratedPlacesFromCSV],
    ["rail_stations", seedRailStations],
  ];
  for (const [name, seed] of seeds) {
    try {
      await seed();
    } catch (error) {
      logger.warn({
        operation: "demo_seed_catalogue_error",
        catalogue: name,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }
}

/**
 * Switches the instance's beta features ON, so the demo shows rail,
 * roadtrips, tours and the rest right away (owner, 2026-09-26). It goes
 * through `updateInstanceSettings` — the same write the admin's switch makes —
 * and it is the instance's switch, not the account's: on a first install it is
 * on for the administrator too, which is the owner's intent (production runs
 * with beta on deliberately). An admin may switch it off again afterwards; the
 * next reseed switches it back on, and says so in the log.
 */
export async function enableBetaForDemo(): Promise<boolean> {
  const before = await getInstanceSettings();
  if (before.betaFeaturesEnabled) {
    logger.info(
      { operation: "demo_seed_beta_features", changed: false },
      "Beta features already on"
    );
    return false;
  }
  await updateInstanceSettings({ betaFeaturesEnabled: true });
  logger.info(
    { operation: "demo_seed_beta_features", changed: true },
    "Beta features switched on for the demo"
  );
  return true;
}
