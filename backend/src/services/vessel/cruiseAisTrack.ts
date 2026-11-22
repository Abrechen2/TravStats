import { prisma } from "../../db";
import { prepareCruiseTrack, cruiseTrackColumns } from "../cruise/prepareCruiseTrack";
import {
  precomputeLegDistancesForCruise,
  recomputeLegsForCruise,
} from "../cruiseDistance/cruiseLegService";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { ingestTrack } from "../tour/tracks/ingestTrack";
import type { ParsedTrack } from "../tour/tracks/parseGpx";

/** The one AIS recording a cruise carries; rebuilt from its fixes after each poll. */
export const CRUISE_AIS_TRACK_REF = "ais";

/**
 * A cruise's AIS fixes become its recorded track with source `ais`, through the
 * same pipeline as an uploaded file (jitter out, holes at sea marked), so the
 * cruise map, the per-leg coverage and the kilometres treat it like any other
 * recording. A hand-drawn leg route (`CruiseLegRoute`) is never touched; where
 * the recording covers a leg it measures that leg, as every recording does.
 */
export async function rebuildCruiseAisTrack(
  cruiseId: string,
  userId: string,
  fixes: Array<{ lat: number; lon: number; observedAt: Date }>
): Promise<boolean> {
  if (fixes.length < 2) return false;
  const parsed: ParsedTrack = {
    points: fixes.map((f) => [f.lon, f.lat]),
    segmentStarts: [0],
    startedAt: fixes[0].observedAt,
    endedAt: fixes[fixes.length - 1].observedAt,
    name: "AIS",
    times: fixes.map((f) => f.observedAt.getTime()),
  };
  const ingested = ingestTrack(prepareCruiseTrack(parsed));
  if (!ingested) return false;
  const columns = cruiseTrackColumns(ingested);
  const legDistances = await precomputeLegDistancesForCruise(cruiseId);
  await prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "cruise", cruiseId);
      await tx.cruiseTrack.deleteMany({ where: { cruiseId, externalRef: CRUISE_AIS_TRACK_REF } });
      await tx.cruiseTrack.create({
        data: {
          cruiseId,
          ...columns,
          source: "ais",
          name: "AIS",
          externalRef: CRUISE_AIS_TRACK_REF,
          truncated: false,
        },
      });
      await recomputeLegsForCruise(cruiseId, tx, legDistances);
      await propagateWrite(tx, userId, "cruise", cruiseId, before);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  return true;
}
