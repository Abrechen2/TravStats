import { Prisma } from "../../prisma";
import { haversineKm } from "../../shared/geo/haversine";
import logger from "../../utils/logger";
import { readStoredLine } from "../rail/railGeometry";
import { lineLengthKm, type LonLat } from "../rail/railGeometryMath";
import { withTimeout } from "../tour/routing/autoRouteLegs";
import { isSharedDemoUser } from "../../utils/sharedDemo";
import { takeProviderCall } from "../tour/routing/providerBudget";
import { resolveRouteProvider } from "../tour/routing/resolveProvider";
import { routeLegGeometry } from "../tour/routing/routeLeg";
import type { RouteFallbackReason } from "../tour/routing/types";

/**
 * The road line of a coach ride (spec 2026-10-07-bus-domain-design §5, B3).
 *
 * Fetched ONCE, when the ride is saved or when the user asks for it, and
 * frozen with the row: `geometry`, `geometrySource = road`, and the routed
 * length as `distanceKm` (`distanceSource = route`). Anything that does not
 * deliver stores the straight chord and says why, in the provider's own
 * reason code — never a silent chord (the "provider failure becomes silent
 * success" defect class).
 *
 * The routing itself is the tours' (`services/tour/routing/`); this file only
 * decides WHEN to ask and what a ride keeps when the answer is worse than what
 * it has.
 */

/**
 * The provider adapters carry no timeout of their own. A save waits at most
 * this long — well under the client's 10 s — and a hanging provider reads as
 * `provider_error`.
 */
export const BUS_ROUTE_TIMEOUT_MS = 6_000;

/** A kept line must still start and end at the (possibly corrected) terminals. */
const KEPT_LINE_ANCHOR_KM = 1;

export interface BusEnds {
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
}

/** What one routing attempt delivered. */
export interface BusLine {
  geometry: LonLat[] | null;
  geometrySource: "road" | "straight";
  /** The routed length; null for a straight line (the chord is the state's own figure). */
  routedKm: number | null;
  /** Why no road line came back; null when one did. */
  fallback: RouteFallbackReason | null;
}

const round1 = (km: number): number => Math.round(km * 10) / 10;

/** One routing attempt between the two terminals. Never throws for a routing failure. */
export async function fetchBusLine(userId: string, ends: BusEnds): Promise<BusLine> {
  const straight = (fallback: RouteFallbackReason): BusLine => ({
    geometry: null,
    geometrySource: "straight",
    routedKm: null,
    fallback,
  });
  try {
    // The shared demo account never spends the instance's routing key: its
    // rides save as straight lines, and the routing endpoint reports "none".
    if (await isSharedDemoUser(userId)) return straight("no_provider");
    const provider = await resolveRouteProvider(userId);
    const routed = await withTimeout(
      routeLegGeometry(
        provider,
        {
          from: { lat: ends.depLat, lon: ends.depLon },
          to: { lat: ends.arrLat, lon: ends.arrLon },
          mode: "road",
        },
        () => takeProviderCall(userId) === "ok"
      ),
      BUS_ROUTE_TIMEOUT_MS
    );
    if (routed === null) {
      logger.warn(
        { operation: "bus.route", userId },
        "road routing timed out; ride stays straight"
      );
      return straight("provider_error");
    }
    if (routed.source !== "routed" || routed.waypoints === null) {
      return straight(routed.fallbackReason ?? "provider_error");
    }
    return {
      geometry: routed.waypoints,
      geometrySource: "road",
      routedKm: round1(routed.distanceKm),
      fallback: null,
    };
  } catch (error) {
    logger.warn(
      { operation: "bus.route", userId, error: error instanceof Error ? error.message : error },
      "road routing failed; ride stays straight"
    );
    return straight("provider_error");
  }
}

/** The stored row as the edit rule reads it. */
export interface StoredBusLine extends BusEnds {
  geometry: unknown;
  geometrySource: string;
  distanceKm: number | null;
  distanceSource: string | null;
}

/**
 * What a save did to the line: left it alone, fetched it, or tried to fetch a
 * new one and kept the frozen road line because the answer was worse.
 */
export type BusLineEdit =
  | { kind: "unchanged" }
  | { kind: "fetched"; line: BusLine }
  | { kind: "kept"; geometry: LonLat[]; fallback: RouteFallbackReason | null };

const terminalsMoved = (a: BusEnds, b: BusEnds): boolean =>
  a.depLat !== b.depLat || a.depLon !== b.depLon || a.arrLat !== b.arrLat || a.arrLon !== b.arrLon;

function anchored(line: LonLat[], ends: BusEnds): boolean {
  const head = line[0];
  const tail = line[line.length - 1];
  return (
    haversineKm({ lat: head[1], lon: head[0] }, { lat: ends.depLat, lon: ends.depLon }) <=
      KEPT_LINE_ANCHOR_KM &&
    haversineKm({ lat: tail[1], lon: tail[0] }, { lat: ends.arrLat, lon: ends.arrLon }) <=
      KEPT_LINE_ANCHOR_KM
  );
}

/**
 * The edit rule for the frozen line (rail review finding 1): the form sends
 * both terminals on EVERY save, so their presence says nothing — the line is
 * fetched again only when a terminal's coordinates differ from the stored row.
 * A re-fetch that fails keeps a stored road line as long as it still starts
 * and ends at the terminals; a line that no longer reaches a moved terminal
 * would be a lie on the map, so that case stores the chord and says why.
 */
export async function resolveEditedBusLine(
  userId: string,
  existing: StoredBusLine,
  next: BusEnds
): Promise<BusLineEdit> {
  if (!terminalsMoved(existing, next)) return { kind: "unchanged" };
  const line = await fetchBusLine(userId, next);
  if (line.geometrySource === "road") return { kind: "fetched", line };
  const stored = existing.geometrySource === "road" ? readStoredLine(existing.geometry) : null;
  if (stored && anchored(stored, next)) {
    return { kind: "kept", geometry: stored, fallback: line.fallback };
  }
  return { kind: "fetched", line };
}

/** The line a row ends up with, in the shape the geometry columns take. */
export interface BusLineColumns {
  geometry: LonLat[] | null;
  geometrySource: "road" | "straight";
}

/** The geometry columns of a write; the null line is SQL NULL, not JSON null. */
export function busGeometryColumns(line: BusLineColumns): {
  geometry: Prisma.InputJsonValue | typeof Prisma.DbNull;
  geometrySource: string;
} {
  return {
    geometry:
      line.geometry === null ? Prisma.DbNull : (line.geometry as unknown as Prisma.InputJsonValue),
    geometrySource: line.geometrySource,
  };
}

/** The line to write for an edit, or null when the stored one stays as it is. */
export function writtenLine(edit: BusLineEdit): BusLineColumns | null {
  if (edit.kind === "unchanged") return null;
  if (edit.kind === "kept") return { geometry: edit.geometry, geometrySource: "road" };
  return { geometry: edit.line.geometry, geometrySource: edit.line.geometrySource };
}

/**
 * The distance once the line is known. A typed ticket distance always wins,
 * whichever line exists; a road line's own length beats the great-circle
 * figure, which understates a road by 10–40 %; without a road line the
 * great-circle figure the merge computed stands, labelled so.
 */
export function withRoutedDistance<
  S extends { distanceKm: number | null; distanceSource: string | null },
>(state: S, existing: StoredBusLine | null, edit: BusLineEdit): S {
  if (state.distanceSource === "user") return state;
  const keptStored = edit.kind === "unchanged" || edit.kind === "kept";
  const storedLine = existing ? readStoredLine(existing.geometry) : null;
  const roadLine =
    edit.kind === "fetched"
      ? edit.line.geometrySource === "road"
        ? edit.line.geometry
        : null
      : edit.kind === "kept"
        ? edit.geometry
        : existing?.geometrySource === "road"
          ? storedLine
          : null;
  if (!roadLine) return state;
  const routedKm =
    edit.kind === "fetched"
      ? edit.line.routedKm
      : keptStored && existing?.distanceSource === "route" && existing.distanceKm !== null
        ? existing.distanceKm
        : null;
  return {
    ...state,
    distanceKm: routedKm ?? round1(lineLengthKm(roadLine)),
    distanceSource: "route",
  };
}

/** `meta.geometry`: what a save (or a "route again") did to the line. */
export interface BusGeometryReport {
  outcome: "unchanged" | "routed" | "straight" | "kept";
  geometrySource: string;
  fallback: RouteFallbackReason | null;
}

export function busGeometryReport(edit: BusLineEdit, storedSource: string): BusGeometryReport {
  if (edit.kind === "unchanged") {
    return { outcome: "unchanged", geometrySource: storedSource, fallback: null };
  }
  if (edit.kind === "kept") {
    return { outcome: "kept", geometrySource: "road", fallback: edit.fallback };
  }
  return {
    outcome: edit.line.geometrySource === "road" ? "routed" : "straight",
    geometrySource: edit.line.geometrySource,
    fallback: edit.line.fallback,
  };
}
