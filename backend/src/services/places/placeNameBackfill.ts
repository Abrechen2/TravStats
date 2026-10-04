/**
 * Bring stored places into the two-name format (forgejo#199).
 *
 * Since 2.7.0-rc.7 a place picked from search carries a Latin `name` and the
 * sign's `localName`. Places saved before that hold one string, in one of two
 * shapes this pass repairs — and nothing else:
 *
 *   1. GLUED: "Banpo Bridge Moonlight Rainbow Fountain 반포대교 달빛무지개분수".
 *      Split by `geo/gluedPlaceName.ts`, no network.
 *   2. NON-LATIN ONLY: "교촌치킨 서울시청점". The Latin name is looked up:
 *      - `externalRef` `osm:…` → Photon text search for the stored name near
 *        the pin, in English, and the hit with that very OSM identity;
 *      - otherwise (prod's four were all `companion:@lat,lon` placeholders) →
 *        Photon `/reverse` at the pin with `lang=default`, the hit whose own
 *        name equals the stored one (NFC, case-folded, whitespace collapsed)
 *        within 150 m, and that hit's English name through the SAME merge the
 *        live search uses (`geo/placeNames.ts`, `mergePlaceNames`).
 *      Found → `name` = Latin, `localName` = the stored one; and a placeholder
 *      `companion:@…` ref becomes the matched `osm:` ref, unless another place
 *      of the same user already holds it (`@@unique([userId, externalRef])`).
 *      Not found → nothing is written, and the place is reported (abstention:
 *      no transliteration is ever invented).
 *
 * Idempotent: a repaired place has a `localName` and is no candidate again;
 * an abstained one is looked up again and again changes nothing.
 *
 * Network discipline: the geocoder passed in is the only way out, the
 * production one is throttled to Photon's fair use (`throttledPhoton`), the
 * run is capped, and a failed lookup is a reported abstention, never a throw.
 * Logs carry counts only — never a place name.
 */
import type { Prisma } from "../../prisma";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { haversineKm } from "../../shared/geo/haversine";
import { splitGluedName } from "../geo/gluedPlaceName";
import { isNonLatin, mergePlaceNames } from "../geo/placeNames";
import type { PlaceResult } from "../geo/photon";

/** How far a reverse hit may lie from the pin and still be this place. */
export const NAME_MATCH_RADIUS_M = 150;
/** Places looked up over the network per run (the splits cost nothing and are not capped). */
export const DEFAULT_LOOKUP_CAP = 100;

/** The three questions the pass asks a geocoder. Null = the request failed. */
export interface PlaceNameGeocoder {
  /** Text search near a point, names in English. */
  searchEnglish(query: string, lat: number, lon: number): Promise<PlaceResult[] | null>;
  /** Objects nearest a point, names in their own script (`lang=default`). */
  reverseDefault(lat: number, lon: number): Promise<PlaceResult[] | null>;
  /** The same objects, names in English. */
  reverseEnglish(lat: number, lon: number): Promise<PlaceResult[] | null>;
}

const SELECT = {
  id: true,
  userId: true,
  name: true,
  localName: true,
  externalRef: true,
  lat: true,
  lon: true,
} as const satisfies Prisma.PlaceSelect;
type Row = Prisma.PlaceGetPayload<{ select: typeof SELECT }>;

export type NameChangeKind = "split" | "latin";
export type AbstainReason = "lookup_failed" | "no_match" | "no_latin_name" | "cap_reached";

export interface NameChange {
  placeId: string;
  userId: string;
  kind: NameChangeKind;
  before: { name: string; externalRef: string | null };
  after: { name: string; localName: string; externalRef: string | null };
  /** The matched OSM ref was already another place's; the ref stays as it was. */
  refCollision?: boolean;
}

export interface NameAbstention {
  placeId: string;
  userId: string;
  name: string;
  reason: AbstainReason;
}

export interface NameBackfillReport {
  apply: boolean;
  scanned: number;
  changes: NameChange[];
  abstentions: NameAbstention[];
  lookups: number;
}

export interface NameBackfillOptions {
  geocoder: PlaceNameGeocoder;
  apply: boolean;
  userId?: string;
  lookupCap?: number;
}

const COMPANION_PLACEHOLDER = /^companion:@/;
const PAGE = 500;

/** NFC, case-folded, whitespace collapsed — how two spellings of one name compare. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
  return norm(a) === norm(b);
}

const needsWork = (r: Row): boolean => r.localName === null && isNonLatin(r.name);

async function loadCandidates(userId?: string): Promise<Row[]> {
  const out: Row[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page: Row[] = await prisma.place.findMany({
      where: { localName: null, ...(userId ? { userId } : {}) },
      select: SELECT,
      orderBy: { id: "asc" },
      take: PAGE,
      ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
    });
    out.push(...page.filter(needsWork));
    if (page.length < PAGE) return out;
    afterId = page[page.length - 1].id;
  }
}

type Lookup =
  | { found: true; name: string; osmRef: string | undefined }
  | { found: false; reason: AbstainReason };

const latinOrNull = (candidate: string | undefined, stored: string): string | null =>
  candidate && !isNonLatin(candidate) && !sameName(candidate, stored) ? candidate : null;

async function lookupByOsmRef(row: Row, ref: string, geo: PlaceNameGeocoder): Promise<Lookup> {
  const hits = await geo.searchEnglish(row.name, row.lat, row.lon);
  if (!hits) return { found: false, reason: "lookup_failed" };
  const hit = hits.find((h) => h.externalRef === ref);
  if (!hit) return { found: false, reason: "no_match" };
  const name = latinOrNull(hit.name, row.name);
  return name ? { found: true, name, osmRef: ref } : { found: false, reason: "no_latin_name" };
}

async function lookupByCoordinates(row: Row, geo: PlaceNameGeocoder): Promise<Lookup> {
  const local = await geo.reverseDefault(row.lat, row.lon);
  if (!local) return { found: false, reason: "lookup_failed" };
  const match = local.find(
    (h) =>
      h.externalRef !== undefined &&
      sameName(h.name, row.name) &&
      haversineKm(h, row) * 1000 <= NAME_MATCH_RADIUS_M
  );
  if (!match) return { found: false, reason: "no_match" };
  const english = await geo.reverseEnglish(row.lat, row.lon);
  if (!english) return { found: false, reason: "lookup_failed" };
  const [merged] = mergePlaceNames([match], english, [match]);
  const name = latinOrNull(merged?.name, row.name);
  return name
    ? { found: true, name, osmRef: match.externalRef }
    : { found: false, reason: "no_latin_name" };
}

/** May this place take `ref`? Only from a placeholder, and only when no other place of the user holds it. */
async function refToAdopt(
  row: Row,
  ref: string | undefined,
  claimed: Set<string>
): Promise<{ ref: string | null; collision: boolean }> {
  if (!ref || !row.externalRef || !COMPANION_PLACEHOLDER.test(row.externalRef)) {
    return { ref: row.externalRef, collision: false };
  }
  const key = `${row.userId}\u0000${ref}`;
  const holder = await prisma.place.findFirst({
    where: { userId: row.userId, externalRef: ref, id: { not: row.id } },
    select: { id: true },
  });
  if (holder || claimed.has(key)) return { ref: row.externalRef, collision: true };
  claimed.add(key);
  return { ref, collision: false };
}

async function write(change: NameChange): Promise<void> {
  await prisma.place.update({
    where: { id: change.placeId },
    data: {
      name: change.after.name,
      localName: change.after.localName,
      externalRef: change.after.externalRef,
    },
  });
}

/** Run the pass. Dry run unless `apply`; the report is the same either way. */
export async function backfillPlaceNames(opts: NameBackfillOptions): Promise<NameBackfillReport> {
  const cap = opts.lookupCap ?? DEFAULT_LOOKUP_CAP;
  const rows = await loadCandidates(opts.userId);
  const report: NameBackfillReport = {
    apply: opts.apply,
    scanned: rows.length,
    changes: [],
    abstentions: [],
    lookups: 0,
  };
  const claimed = new Set<string>();

  for (const row of rows) {
    const change = await changeFor(row, opts.geocoder, report, cap, claimed);
    if (!change) continue;
    report.changes.push(change);
    if (!opts.apply) continue;
    try {
      await write(change);
    } catch (err) {
      // One row that cannot be written (a ref taken between check and write)
      // must not abandon the rest.
      report.changes.pop();
      report.abstentions.push({ ...pick(row), reason: "lookup_failed" });
      logger.warn(
        { operation: "place_name_backfill_write_failed", placeId: row.id, err: String(err) },
        "Place name backfill could not write one place — continuing"
      );
    }
  }

  logger.info(
    {
      operation: "place_name_backfill",
      apply: opts.apply,
      scanned: report.scanned,
      split: report.changes.filter((c) => c.kind === "split").length,
      latin: report.changes.filter((c) => c.kind === "latin").length,
      refAdopted: report.changes.filter((c) => c.after.externalRef !== c.before.externalRef).length,
      refCollisions: report.changes.filter((c) => c.refCollision).length,
      abstained: report.abstentions.length,
      lookups: report.lookups,
    },
    "Place name backfill finished"
  );
  return report;
}

const pick = (row: Row) => ({ placeId: row.id, userId: row.userId, name: row.name });

async function changeFor(
  row: Row,
  geo: PlaceNameGeocoder,
  report: NameBackfillReport,
  cap: number,
  claimed: Set<string>
): Promise<NameChange | null> {
  const before = { name: row.name, externalRef: row.externalRef };
  const split = splitGluedName(row.name);
  if (split) {
    return {
      placeId: row.id,
      userId: row.userId,
      kind: "split",
      before,
      after: { ...split, externalRef: row.externalRef },
    };
  }
  if (report.lookups >= cap) {
    report.abstentions.push({ ...pick(row), reason: "cap_reached" });
    return null;
  }
  report.lookups += 1;
  let found: Lookup;
  try {
    found = row.externalRef?.startsWith("osm:")
      ? await lookupByOsmRef(row, row.externalRef, geo)
      : await lookupByCoordinates(row, geo);
  } catch {
    found = { found: false, reason: "lookup_failed" };
  }
  if (!found.found) {
    report.abstentions.push({ ...pick(row), reason: found.reason });
    return null;
  }
  const adopted = await refToAdopt(row, found.osmRef, claimed);
  return {
    placeId: row.id,
    userId: row.userId,
    kind: "latin",
    before,
    after: { name: found.name, localName: row.name, externalRef: adopted.ref },
    ...(adopted.collision ? { refCollision: true } : {}),
  };
}
