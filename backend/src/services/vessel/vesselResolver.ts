import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import logger from "../../utils/logger";
import { collectStaticData, type AisStaticVessel } from "../ferry/aisStream";
import { egressBlock } from "../externalServices/egress";
import { offReasonFor } from "../externalServices/policy";
import { isImo, isMmsi, normaliseVesselName, operatorMatches } from "./vesselName";
import {
  searchWikidataByImo,
  searchWikidataByName,
  type WikidataVessel,
  type WikidataVesselResult,
} from "./wikidataVessel";

/**
 * Vessel name → MMSI (2026-11-22). Nobody knows their ship's MMSI, so the
 * server finds it, in this order:
 *   (a) the local ship catalogue (`Ship.mmsi`, or its IMO for the next step);
 *   (b) Wikidata — P587 MMSI, P458 IMO — by IMO, else by exact name, sharpened
 *       by the operator;
 *   (c) AISStream ShipStaticData around the journey, while the ship is in range.
 * Every source must be UNAMBIGUOUS: two ships of the same name and no operator
 * to tell them apart is a result ("ambiguous"), not a coin toss. A guessed MMSI
 * would draw a stranger's ship as the user's voyage. Results are cached per
 * lookup key in `vessel_identities`, with their source and confidence.
 */

export const VESSEL_DATA_SERVICE = "vesselData";
export const AIS_SERVICE = "aisstream";

export type VesselSource = "catalogue" | "wikidata" | "aisstream";
export type VesselConfidence = "high" | "medium";
export type VesselUnresolvedReason = "ambiguous" | "notFound" | "unavailable" | "noName";

export interface VesselCandidate {
  mmsi: string;
  imo: string | null;
  name: string;
  operator: string | null;
  source: VesselSource;
}

export type VesselResolution =
  | {
      status: "resolved";
      mmsi: string;
      imo: string | null;
      source: VesselSource;
      confidence: VesselConfidence;
    }
  | { status: "unresolved"; reason: VesselUnresolvedReason; candidates: VesselCandidate[] };

export interface VesselQuery {
  name: string | null;
  operator: string | null;
  imo?: string | null;
  shipId?: number | null;
  /** Where the ship should be (the journey's ends), for the AIS step. */
  area?: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null;
  /** The account the lookup runs for — its own service switches apply. */
  userId: string;
  /**
   * Whether the AIS step may run (up to 20 s on a socket). A page load asks
   * without it; the poller, during the voyage, with it. Without it a "not
   * found" is not cached, so the poller's AIS attempt is not shut out.
   */
  ais?: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
/** How long each outcome is trusted before the resolver may ask again. */
const RETRY_MS: Record<"resolved" | VesselUnresolvedReason, number> = {
  resolved: 90 * DAY,
  ambiguous: 14 * DAY,
  // Short: the AIS step can find a ship next time it is in range.
  notFound: 6 * 60 * 60 * 1000,
  unavailable: 60 * 60 * 1000,
  noName: 0,
};
const MAX_CANDIDATES = 20;

export function lookupKeyOf(q: Pick<VesselQuery, "name" | "operator" | "imo">): string | null {
  if (isImo(q.imo)) return `imo:${q.imo}`;
  const name = normaliseVesselName(q.name);
  if (!name) return null;
  return `name:${name}|op:${normaliseVesselName(q.operator)}`;
}

const toCandidate = (v: WikidataVessel): VesselCandidate | null =>
  v.mmsi
    ? {
        mmsi: v.mmsi,
        imo: v.imo,
        name: v.name,
        operator: v.operators[0] ?? null,
        source: "wikidata",
      }
    : null;

function distinctByMmsi<T extends { mmsi: string | null }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((v) => v.mmsi !== null && !seen.has(v.mmsi) && seen.add(v.mmsi) !== undefined);
}

/**
 * Pick from Wikidata's answer: by IMO any single MMSI is "high"; by name the
 * items whose label or alias IS the name, narrowed by the operator where that
 * leaves exactly one ship. One ship by name alone is "medium".
 */
export function pickWikidata(
  vessels: WikidataVessel[],
  q: Pick<VesselQuery, "name" | "operator" | "imo">
): VesselResolution {
  if (isImo(q.imo)) {
    const hits = distinctByMmsi(vessels.filter((v) => v.imo === q.imo));
    if (hits.length === 1)
      return {
        status: "resolved",
        mmsi: hits[0].mmsi!,
        imo: q.imo,
        source: "wikidata",
        confidence: "high",
      };
    return {
      status: "unresolved",
      reason: hits.length > 1 ? "ambiguous" : "notFound",
      candidates: hits.flatMap((v) => toCandidate(v) ?? []),
    };
  }
  const name = normaliseVesselName(q.name);
  // Every SHIP of that name counts, with or without an MMSI on Wikidata: a
  // second "Roald Amundsen" that only lacks the property is still a second
  // ship, and picking the one that has it drew a German brig as a Hurtigruten
  // voyage (measured 2026-11-22 against the owner's cruises).
  const named = vessels.filter((v) => v.names.some((n) => normaliseVesselName(n) === name));
  const candidates = distinctByMmsi(named).flatMap((v) => toCandidate(v) ?? []);
  const abstain = (reason: VesselUnresolvedReason): VesselResolution => ({
    status: "unresolved",
    reason,
    candidates,
  });
  const resolved = (v: WikidataVessel, confidence: VesselConfidence): VesselResolution =>
    v.mmsi
      ? { status: "resolved", mmsi: v.mmsi, imo: v.imo, source: "wikidata", confidence }
      : abstain("notFound");
  const byOperator = q.operator
    ? named.filter((v) => v.operators.some((o) => operatorMatches(o, q.operator)))
    : [];
  if (byOperator.length === 1) return resolved(byOperator[0], "high");
  if (byOperator.length > 1 || named.length > 1) return abstain("ambiguous");
  if (named.length === 0) return abstain("notFound");
  // One ship of that name, but the journey names an operator the item does not
  // confirm: Wikidata may simply not know the other ship (the Hurtigruten
  // "Roald Amundsen" has no item the search finds; a German brig does). Offer
  // it as a candidate, never bind it.
  if (q.operator) return abstain("ambiguous");
  return resolved(named[0], "medium");
}

/** AIS ShipStaticData: the one vessel in the box whose IMO, else name, is the ship's. */
export function pickAisStatic(
  vessels: AisStaticVessel[],
  q: Pick<VesselQuery, "name" | "imo">
): VesselResolution {
  if (isImo(q.imo)) {
    const byImo = distinctByMmsi(vessels.filter((v) => v.imo === q.imo));
    if (byImo.length === 1)
      return {
        status: "resolved",
        mmsi: byImo[0].mmsi,
        imo: q.imo,
        source: "aisstream",
        confidence: "high",
      };
  }
  const name = normaliseVesselName(q.name);
  const named = distinctByMmsi(vessels.filter((v) => normaliseVesselName(v.name) === name));
  const candidates = named.map((v) => ({
    mmsi: v.mmsi,
    imo: v.imo,
    name: v.name,
    operator: null,
    source: "aisstream" as const,
  }));
  if (named.length === 1)
    return {
      status: "resolved",
      mmsi: named[0].mmsi,
      imo: named[0].imo,
      source: "aisstream",
      confidence: "medium",
    };
  return { status: "unresolved", reason: named.length > 1 ? "ambiguous" : "notFound", candidates };
}

async function fromCatalogue(
  q: VesselQuery
): Promise<{ resolution: VesselResolution | null; imo: string | null }> {
  const ship = q.shipId
    ? await prisma.ship.findUnique({ where: { id: q.shipId }, select: { mmsi: true, imo: true } })
    : null;
  if (ship && isMmsi(ship.mmsi))
    return {
      resolution: {
        status: "resolved",
        mmsi: ship.mmsi,
        imo: ship.imo,
        source: "catalogue",
        confidence: "high",
      },
      imo: ship.imo,
    };
  if (ship) return { resolution: null, imo: isImo(ship.imo) ? ship.imo : null };
  const name = normaliseVesselName(q.name);
  if (!name) return { resolution: null, imo: null };
  // A name-only catalogue match counts only when the catalogue has exactly one such ship.
  const rows = await prisma.ship.findMany({
    where: { name: { equals: q.name!.trim(), mode: "insensitive" } },
    select: { mmsi: true, imo: true, cruiseLine: true },
    take: 3,
  });
  if (rows.length !== 1) return { resolution: null, imo: null };
  const only = rows[0];
  if (isMmsi(only.mmsi))
    return {
      resolution: {
        status: "resolved",
        mmsi: only.mmsi,
        imo: only.imo,
        source: "catalogue",
        confidence: "medium",
      },
      imo: only.imo,
    };
  return { resolution: null, imo: isImo(only.imo) ? only.imo : null };
}

async function allowed(service: string, userId: string): Promise<boolean> {
  return (await egressBlock(service)) === null && (await offReasonFor(service, userId)) === null;
}

async function fromWikidata(q: VesselQuery, imo: string | null): Promise<VesselResolution> {
  if (!(await allowed(VESSEL_DATA_SERVICE, q.userId)))
    return { status: "unresolved", reason: "unavailable", candidates: [] };
  let answer: WikidataVesselResult = imo
    ? await searchWikidataByImo(imo)
    : await searchWikidataByName(q.name ?? "");
  if (!answer.ok) return { status: "unresolved", reason: "unavailable", candidates: [] };
  let picked = pickWikidata(answer.vessels, { ...q, imo });
  // An IMO Wikidata does not know may still be a named item there.
  if (picked.status === "unresolved" && picked.reason === "notFound" && imo && q.name) {
    answer = await searchWikidataByName(q.name);
    if (!answer.ok) return { status: "unresolved", reason: "unavailable", candidates: [] };
    picked = pickWikidata(answer.vessels, { ...q, imo: null });
  }
  return picked;
}

async function fromAis(q: VesselQuery, imo: string | null): Promise<VesselResolution> {
  if (q.ais === false || !q.area || !(await allowed(AIS_SERVICE, q.userId)))
    return { status: "unresolved", reason: "notFound", candidates: [] };
  const name = normaliseVesselName(q.name);
  const result = await collectStaticData(q.area, (seen) =>
    seen.some((v) => (imo !== null && v.imo === imo) || normaliseVesselName(v.name) === name)
  );
  if (result.status !== "ok")
    return { status: "unresolved", reason: "unavailable", candidates: [] };
  return pickAisStatic(result.vessels, { name: q.name, imo });
}

async function readCache(key: string, now: Date): Promise<VesselResolution | null> {
  const row = await prisma.vesselIdentity.findUnique({ where: { lookupKey: key } });
  if (!row || row.nextAttemptAt <= now) return null;
  if (isMmsi(row.mmsi) && row.source && row.confidence)
    return {
      status: "resolved",
      mmsi: row.mmsi,
      imo: row.imo,
      source: row.source as VesselSource,
      confidence: row.confidence as VesselConfidence,
    };
  return {
    status: "unresolved",
    reason: (row.reason as VesselUnresolvedReason) ?? "notFound",
    candidates: Array.isArray(row.candidates)
      ? (row.candidates as unknown as VesselCandidate[])
      : [],
  };
}

async function writeCache(key: string, name: string | null, r: VesselResolution, now: Date) {
  const retry = RETRY_MS[r.status === "resolved" ? "resolved" : r.reason];
  const data = {
    vesselName: name,
    mmsi: r.status === "resolved" ? r.mmsi : null,
    imo: r.status === "resolved" ? r.imo : null,
    source: r.status === "resolved" ? r.source : null,
    confidence: r.status === "resolved" ? r.confidence : null,
    reason: r.status === "resolved" ? null : r.reason,
    candidates:
      r.status === "resolved"
        ? Prisma.JsonNull
        : (r.candidates.slice(0, MAX_CANDIDATES) as unknown as Prisma.InputJsonValue),
    resolvedAt: now,
    nextAttemptAt: new Date(now.getTime() + retry),
  };
  await prisma.vesselIdentity.upsert({
    where: { lookupKey: key },
    create: { lookupKey: key, ...data },
    update: data,
  });
}

/** Resolve a vessel to its MMSI, or say why not. Never a guess. */
export async function resolveVessel(q: VesselQuery, now = new Date()): Promise<VesselResolution> {
  const catalogue = await fromCatalogue(q);
  if (catalogue.resolution) return catalogue.resolution;
  const imo = catalogue.imo ?? (isImo(q.imo) ? q.imo : null);
  const key = lookupKeyOf({ ...q, imo });
  if (!key) return { status: "unresolved", reason: "noName", candidates: [] };
  const cached = await readCache(key, now);
  if (cached) return cached;

  let result = await fromWikidata(q, imo);
  // AIS asks only when Wikidata had nothing to say; an ambiguous name stays ambiguous.
  if (result.status === "unresolved" && result.reason !== "ambiguous") {
    const ais = await fromAis(q, imo);
    // Otherwise Wikidata's reason stands: "unavailable" retries sooner than "notFound".
    if (ais.status === "resolved" || ais.reason === "ambiguous") result = ais;
  }
  logger.info({
    operation: "vessel.resolve",
    key,
    status: result.status,
    ...(result.status === "resolved"
      ? { source: result.source, confidence: result.confidence }
      : { reason: result.reason }),
  });
  const partial =
    q.ais === false && result.status === "unresolved" && result.reason !== "ambiguous";
  if (!partial) await writeCache(key, q.name, result, now);
  return result;
}

const SEARCH_RETRY_MS = DAY;

/**
 * The manual override's candidates for a name: Wikidata's search (prefix, not
 * exact — the user is looking) plus catalogue ships with an MMSI. The list is
 * cached under `search:<name>`, and a pick is accepted only if it is in it — so
 * the override cannot bind an arbitrary MMSI either.
 */
export async function searchVesselCandidates(
  name: string,
  userId: string,
  now = new Date()
): Promise<{ status: "ok" | "unavailable"; candidates: VesselCandidate[] }> {
  const term = normaliseVesselName(name);
  if (term.length < 2) return { status: "ok", candidates: [] };
  const key = `search:${term}`;
  const cached = await prisma.vesselIdentity.findUnique({ where: { lookupKey: key } });
  if (cached && cached.nextAttemptAt > now && Array.isArray(cached.candidates))
    return { status: "ok", candidates: cached.candidates as unknown as VesselCandidate[] };

  const ships = await prisma.ship.findMany({
    where: { name: { contains: name.trim(), mode: "insensitive" }, mmsi: { not: null } },
    select: { name: true, mmsi: true, imo: true, cruiseLine: true },
    take: MAX_CANDIDATES,
  });
  const fromShips: VesselCandidate[] = ships.flatMap((s) =>
    isMmsi(s.mmsi)
      ? [
          {
            mmsi: s.mmsi,
            imo: s.imo,
            name: s.name,
            operator: s.cruiseLine,
            source: "catalogue" as const,
          },
        ]
      : []
  );
  let fromWiki: VesselCandidate[] = [];
  let status: "ok" | "unavailable" = "ok";
  if (await allowed(VESSEL_DATA_SERVICE, userId)) {
    const answer = await searchWikidataByName(name);
    if (answer.ok) fromWiki = answer.vessels.flatMap((v) => toCandidate(v) ?? []);
    else status = "unavailable";
  } else status = "unavailable";
  const candidates = distinctByMmsi([...fromShips, ...fromWiki]).slice(0, MAX_CANDIDATES);
  if (status === "ok") {
    const data = {
      vesselName: name,
      candidates: candidates as unknown as Prisma.InputJsonValue,
      resolvedAt: now,
      nextAttemptAt: new Date(now.getTime() + SEARCH_RETRY_MS),
    };
    await prisma.vesselIdentity.upsert({
      where: { lookupKey: key },
      create: { lookupKey: key, ...data },
      update: data,
    });
  }
  return { status, candidates };
}

/** Whether `mmsi` is one the server itself offered — for a search, or for this vessel's lookup. */
export async function isOfferedCandidate(
  mmsi: string,
  keys: string[]
): Promise<VesselCandidate | null> {
  if (!isMmsi(mmsi)) return null;
  const rows = await prisma.vesselIdentity.findMany({ where: { lookupKey: { in: keys } } });
  for (const row of rows) {
    const list = Array.isArray(row.candidates)
      ? (row.candidates as unknown as VesselCandidate[])
      : [];
    const hit = list.find((c) => c.mmsi === mmsi);
    if (hit) return hit;
    if (row.mmsi === mmsi && row.source)
      return {
        mmsi,
        imo: row.imo,
        name: row.vesselName ?? mmsi,
        operator: null,
        source: row.source as VesselSource,
      };
  }
  return null;
}

export const searchKeyOf = (name: string) => `search:${normaliseVesselName(name)}`;
