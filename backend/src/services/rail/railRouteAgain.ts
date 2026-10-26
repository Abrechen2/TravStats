import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { propagateWrite, SHARE_TX_TIMEOUT_MS, shareSnapshot } from "../sharing/propagate";
import { greatCircleKm } from "./railJourneyWrite";
import {
  readStoredLine,
  refetchJourneyGeometry,
  tracedLengthKm,
  type GeometryEdit,
  type GeometryFallbackReason,
  type JourneyGeometry,
} from "./railGeometry";

/**
 * What a save did to the line, in `meta.geometry` beside the row (review
 * 2026-09-26, finding 4): a Transitous match saved as a straight line used to
 * be indistinguishable from a good save, so the form said "saved" and the map
 * quietly drew the chord. `fallback` names why; `kept` means a re-fetch did
 * not deliver and the frozen line stayed.
 */
export interface GeometryReport {
  outcome: "unchanged" | "traced" | "routed" | "straight" | "kept";
  geometrySource: string;
  fallback: GeometryFallbackReason | null;
}

export function reportOf(geo: JourneyGeometry): GeometryReport {
  return {
    outcome:
      geo.geometrySource === "straight"
        ? "straight"
        : geo.geometrySource === "openrailrouting"
          ? "routed"
          : "traced",
    geometrySource: geo.geometrySource,
    fallback: geo.fallback,
  };
}

export function editReport(edit: GeometryEdit, storedSource: string): GeometryReport {
  if (edit.kind === "unchanged") {
    return { outcome: "unchanged", geometrySource: storedSource, fallback: null };
  }
  if (edit.kind === "kept") {
    return { outcome: "kept", geometrySource: edit.geometrySource, fallback: edit.fallback };
  }
  return reportOf(edit.geo);
}

/**
 * The columns a fresh answer writes, or null when it changes nothing. A
 * refetch answers a null line only where the stored one is known wrong (a
 * tram routed as a train, `refetchJourneyGeometry`) or there was none to lose.
 */
function refetchColumns(
  existing: Prisma.RailJourneyGetPayload<object>,
  edit: GeometryEdit
): Prisma.RailJourneyUpdateManyMutationInput | null {
  if (edit.kind !== "refetched") return null;
  const line = edit.geo.geometry;
  if (line === null && readStoredLine(existing.geometry) === null) return null;
  const keepDistance = existing.distanceSource === "user";
  if (line === null) {
    return {
      geometry: Prisma.DbNull,
      geometrySource: edit.geo.geometrySource,
      ...(!keepDistance && {
        distanceKm: greatCircleKm(existing),
        distanceSource: "great_circle",
      }),
    };
  }
  return {
    geometry: line as unknown as Prisma.InputJsonValue,
    geometrySource: edit.geo.geometrySource,
    ...(!keepDistance && { distanceKm: tracedLengthKm(line), distanceSource: "route" }),
  };
}

/**
 * "Route again" (#364): resolve one journey's line afresh without touching its
 * stations, times or booking. Null when the journey is not the user's. A
 * provider that does not deliver keeps the stored line and says why in the
 * report; a 409 when the row changed while the provider was asked.
 */
export async function routeRailJourneyAgain(
  userId: string,
  id: string
): Promise<{ id: string; report: GeometryReport } | null> {
  const existing = await prisma.railJourney.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const edit = await refetchJourneyGeometry(existing);
  const columns = refetchColumns(existing, edit);
  if (columns) {
    await prisma.$transaction(
      async (tx) => {
        const before = await shareSnapshot(tx, "rail", existing.id);
        const result = await tx.railJourney.updateMany({
          where: { id: existing.id, userId, updatedAt: existing.updatedAt },
          data: columns,
        });
        if (result.count !== 1)
          throw new AppError("Journey changed while routing; reload and try again", 409);
        await propagateWrite(tx, userId, "rail", existing.id, before);
      },
      { timeout: SHARE_TX_TIMEOUT_MS }
    );
  }
  return { id: existing.id, report: editReport(edit, existing.geometrySource) };
}
