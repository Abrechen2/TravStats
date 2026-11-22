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
  fixes: Array<{ lat: number; lon: number; observedAt: Date; mmsi: string }>
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
  const mmsi = fixes[fixes.length - 1].mmsi;
  return prisma.$transaction(
    async (tx) => {
      // A ship picked meanwhile owns the cruise now: these fixes are not its recording.
      const bound = await tx.cruise.count({ where: { id: cruiseId, vesselMmsi: mmsi } });
      if (bound !== 1 || fixes.some((f) => f.mmsi !== mmsi)) return false;
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
      return true;
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

/** The cruise changed ship: its fixes and its AIS recording go, and the legs are measured again. */
export async function dropCruiseAisRecording(
  cruiseId: string,
  userId: string,
  newMmsi: string
): Promise<void> {
  const legDistances = await precomputeLegDistancesForCruise(cruiseId);
  await prisma.$transaction(
    async (tx) => {
      const before = await shareSnapshot(tx, "cruise", cruiseId);
      // share-exempt: the vessel MMSI is private to the account, never a share fact
      await tx.cruise.updateMany({
        where: { id: cruiseId, userId },
        data: { vesselMmsi: newMmsi, vesselMmsiSource: "manual" },
      });
      await tx.vesselPositionFix.deleteMany({ where: { cruiseId } });
      const dropped = await tx.cruiseTrack.deleteMany({
        where: { cruiseId, externalRef: CRUISE_AIS_TRACK_REF },
      });
      if (dropped.count === 0) return;
      await recomputeLegsForCruise(cruiseId, tx, legDistances);
      await propagateWrite(tx, userId, "cruise", cruiseId, before);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}
