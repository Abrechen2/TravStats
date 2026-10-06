import { prisma } from "../../db";
import logger from "../../utils/logger";
import { haversineKm } from "../../shared/geo/haversine";
import { isNonLatin, writesNonLatinScript } from "../geo/placeNames";
import type { PlaceResult } from "../geo/photon";
import {
  DEFAULT_LOOKUP_CAP,
  NAME_MATCH_RADIUS_M,
  refToAdopt,
  sameName,
  type PlaceNameGeocoder,
} from "./placeNameBackfill";

/**
 * The other half of the two-name format: a place with a readable (Latin) name
 * in a country whose signs use another script gets the name on the sign.
 *
 * Measured on prod, 2026-10-06: 12 places the owner added in Seoul and at the
 * DMZ through the Companion arrived as "Namsan Seoul Tower", "Dorasan
 * Observatory" … with no second name — the app does not send one yet
 * (companion#57). `placeNameBackfill.ts` only looks at names that are NOT
 * Latin, so it never saw them.
 *
 * How a place is matched — never by name alone, always by the map:
 *   1. objects near the pin, in English: the one whose English name is the
 *      stored name, within NAME_MATCH_RADIUS_M (or, for an `osm:` ref, the
 *      object with that ref);
 *   2. the same objects in their own script (`lang=default`): the same OSM
 *      object's name is the local name — kept only when it IS another script
 *      and differs from the stored name.
 * No match, or a match without a local-script name: the place stays as it is
 * (abstention), and the report says why. A Companion placeholder ref is
 * replaced by the matched OSM ref under the same rule as the name backfill.
 */

export type FillAbstainReason =
  "lookup_failed" | "no_match" | "no_local_name" | "cap_reached" | "write_failed";

export interface LocalNameFill {
  placeId: string;
  userId: string;
  name: string;
  localName: string;
  before: { externalRef: string | null };
  after: { externalRef: string | null };
  refCollision?: boolean;
}

export interface LocalNameFillReport {
  apply: boolean;
  scanned: number;
  fills: LocalNameFill[];
  abstentions: Array<{ placeId: string; userId: string; name: string; reason: FillAbstainReason }>;
  lookups: number;
}

interface Row {
  id: string;
  userId: string;
  name: string;
  externalRef: string | null;
  lat: number;
  lon: number;
}

async function loadCandidates(userId?: string): Promise<Row[]> {
  const rows = await prisma.place.findMany({
    where: { localName: null, isoCountryCode: { not: null }, ...(userId ? { userId } : {}) },
    select: {
      id: true,
      userId: true,
      name: true,
      externalRef: true,
      lat: true,
      lon: true,
      isoCountryCode: true,
    },
    orderBy: { id: "asc" },
  });
  return rows
    .filter((r) => writesNonLatinScript(r.isoCountryCode) && !isNonLatin(r.name))
    .map(({ isoCountryCode: _code, ...row }) => row);
}

const near = (hit: PlaceResult, row: Row): boolean =>
  haversineKm(hit, row) * 1000 <= NAME_MATCH_RADIUS_M;

const fold = (s: string): string => s.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();

/**
 * Second tier, for a stored name the map writes longer — "Jongmyo" vs OSM's
 * "Jongmyo Shrine", "Changdeokgung" vs "Changdeokgung Palace" (prod,
 * 2026-10-06): a nearby object whose English name contains the stored name as
 * whole words. Taken only when exactly ONE object qualifies; two candidates is
 * a guess, and a guess is not made.
 */
function onlyContaining(english: readonly PlaceResult[], row: Row): PlaceResult | undefined {
  const needle = fold(row.name);
  if (needle.length < 4) return undefined;
  const words = new RegExp(
    `(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`,
    "u"
  );
  const found = english.filter(
    (h) => h.externalRef !== undefined && near(h, row) && words.test(fold(h.name))
  );
  const refs = new Set(found.map((h) => h.externalRef));
  return refs.size === 1 ? found[0] : undefined;
}

type Found =
  | { ok: true; localName: string; osmRef: string | undefined }
  | { ok: false; reason: FillAbstainReason };

async function lookup(row: Row, geo: PlaceNameGeocoder): Promise<Found> {
  const english = await geo.reverseEnglish(row.lat, row.lon);
  if (!english) return { ok: false, reason: "lookup_failed" };
  const ownRef = row.externalRef?.startsWith("osm:") ? row.externalRef : undefined;
  const match = ownRef
    ? english.find((h) => h.externalRef === ownRef)
    : (english.find(
        (h) => h.externalRef !== undefined && sameName(h.name, row.name) && near(h, row)
      ) ?? onlyContaining(english, row));
  if (!match) return { ok: false, reason: "no_match" };
  const local = await geo.reverseDefault(row.lat, row.lon);
  if (!local) return { ok: false, reason: "lookup_failed" };
  const same = local.find((h) => h.externalRef === match.externalRef);
  const localName = same?.name.trim();
  if (!localName || !isNonLatin(localName) || sameName(localName, row.name)) {
    return { ok: false, reason: "no_local_name" };
  }
  return { ok: true, localName, osmRef: match.externalRef };
}

/** Run the pass. Dry run unless `apply`; the report is the same either way. */
export async function fillLocalNames(opts: {
  geocoder: PlaceNameGeocoder;
  apply: boolean;
  userId?: string;
  lookupCap?: number;
}): Promise<LocalNameFillReport> {
  const cap = opts.lookupCap ?? DEFAULT_LOOKUP_CAP;
  const rows = await loadCandidates(opts.userId);
  const report: LocalNameFillReport = {
    apply: opts.apply,
    scanned: rows.length,
    fills: [],
    abstentions: [],
    lookups: 0,
  };
  const claimed = new Set<string>();
  for (const row of rows) {
    const pick = { placeId: row.id, userId: row.userId, name: row.name };
    if (report.lookups >= cap) {
      report.abstentions.push({ ...pick, reason: "cap_reached" });
      continue;
    }
    report.lookups += 1;
    let found: Found;
    try {
      found = await lookup(row, opts.geocoder);
    } catch {
      found = { ok: false, reason: "lookup_failed" };
    }
    if (!found.ok) {
      report.abstentions.push({ ...pick, reason: found.reason });
      continue;
    }
    const adopted = await refToAdopt(row, found.osmRef, claimed);
    const fill: LocalNameFill = {
      ...pick,
      localName: found.localName,
      before: { externalRef: row.externalRef },
      after: { externalRef: adopted.ref },
      ...(adopted.collision ? { refCollision: true } : {}),
    };
    report.fills.push(fill);
    if (!opts.apply) continue;
    try {
      await prisma.place.update({
        where: { id: row.id },
        data: { localName: fill.localName, externalRef: fill.after.externalRef },
      });
    } catch (err) {
      report.fills.pop();
      report.abstentions.push({ ...pick, reason: "write_failed" });
      logger.warn(
        { operation: "local_name_fill_write_failed", placeId: row.id, err: String(err) },
        "Local-name fill could not write one place — continuing"
      );
    }
  }
  logger.info(
    {
      operation: "local_name_fill",
      apply: opts.apply,
      scanned: report.scanned,
      filled: report.fills.length,
      abstained: report.abstentions.length,
      lookups: report.lookups,
    },
    "Local-name fill finished"
  );
  return report;
}
