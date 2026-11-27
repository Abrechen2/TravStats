/**
 * The version-6 half of the reader (UAT 2026-11-27, `formatExtras.ts`): what an import used to
 * drop is written onto the entries this import created — a flight's gate, terminal and flown
 * distance, a ferry's line, a cruise's legs and drawn lines. An entry the account already held
 * (skipped or attached) keeps its own values. Ports are matched by UN/LOCODE, as the cruise's port
 * calls are; a leg between ports this catalogue lacks is left out rather than guessed.
 */
import type { DbTransaction } from "../../../db";
import type { Prisma } from "../../../prisma";
import type { TripFile } from "./format";
import type { StopSourceDomain } from "./formatExtras";
import type { TripFileProposal } from "./types";

type Created = (kind: "flight" | "ferry" | "cruise", key: string) => string | null;

/** The id-map kind each wrapping domain names. */
export const STOP_SOURCE_KIND: Record<
  StopSourceDomain,
  "flight" | "stay" | "cruise" | "rail" | "bus" | "ferry" | "rental"
> = {
  flight: "flight",
  lodging: "stay",
  cruise: "cruise",
  rail: "rail",
  bus: "bus",
  ferry: "ferry",
  rental: "rental",
};

export function createdIds(
  proposal: TripFileProposal,
  ids: Record<string, Map<string, string>>
): Created {
  const created = new Set(
    proposal.entries.filter((e) => e.action === "create").map((e) => `${e.kind}:${e.key}`)
  );
  return (kind, key) => (created.has(`${kind}:${key}`) ? (ids[kind]?.get(key) ?? null) : null);
}

export async function applyExtras(tx: DbTransaction, file: TripFile, created: Created) {
  for (const f of file.flights) {
    const id = created("flight", f.key);
    if (!id || (f.gate == null && f.terminal == null && f.routeDistance == null)) continue;
    // share-exempt: an entry this import created, propagated with it by writeAll
    await tx.flight.update({
      where: { id },
      data: {
        gate: f.gate ?? null,
        terminal: f.terminal ?? null,
        ...(f.routeDistance != null ? { routeDistance: f.routeDistance } : {}),
      },
    });
  }
  for (const r of file.ferry) {
    const id = created("ferry", r.key);
    if (!id || !r.geometry) continue;
    // share-exempt: an entry this import created, propagated with it by writeAll
    await tx.ferryJourney.update({
      where: { id },
      data: {
        geometry: r.geometry as unknown as Prisma.InputJsonValue,
        geometrySource: r.geometrySource ?? "straight",
        manualScope: r.manualScope ?? null,
      },
    });
  }
  const codes = [
    ...new Set(
      file.cruises.flatMap((c) =>
        [...(c.legs ?? []), ...(c.legRoutes ?? [])].flatMap((l) =>
          [l.from.unlocode, l.to.unlocode].filter((u): u is string => !!u)
        )
      )
    ),
  ];
  if (codes.length === 0) return;
  const ports = new Map(
    (
      await tx.port.findMany({
        where: { unlocode: { in: codes } },
        select: { id: true, unlocode: true },
      })
    ).map((p) => [p.unlocode as string, p.id])
  );
  const portOf = (p: { unlocode: string | null }) =>
    p.unlocode ? (ports.get(p.unlocode) ?? null) : null;
  for (const c of file.cruises) {
    const cruiseId = created("cruise", c.key);
    if (!cruiseId) continue;
    for (const l of c.legs ?? []) {
      const [fromPortId, toPortId] = [portOf(l.from), portOf(l.to)];
      if (fromPortId === null || toPortId === null) continue;
      // share-exempt: a leg of a cruise this import created, propagated with it by writeAll
      await tx.cruiseLeg.create({
        data: {
          cruiseId,
          ordinal: l.ordinal,
          fromPortId,
          toPortId,
          distanceKm: l.distanceKm,
          method: l.method,
          routerVersion: l.routerVersion,
          dataVersion: l.dataVersion ?? null,
          confidence: l.confidence,
          ...(l.computedAt ? { computedAt: new Date(l.computedAt) } : {}),
        },
      });
    }
    for (const r of c.legRoutes ?? []) {
      const [from, to] = [portOf(r.from), portOf(r.to)];
      if (from === null || to === null) continue;
      // share-exempt: a line of a cruise this import created, propagated with it by writeAll
      await tx.cruiseLegRoute.create({
        data: {
          cruiseId,
          fromKind: "port",
          fromRef: String(from),
          toKind: "port",
          toRef: String(to),
          waypoints: r.waypoints as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
}
