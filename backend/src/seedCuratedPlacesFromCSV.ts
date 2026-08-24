import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import type { CuratedList, CuratedPlace } from "@prisma/client";
import { prisma } from "./db";
import logger from "./utils/logger";

interface CSVCuratedList {
  key: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  sortIdx: string;
}

interface CSVCuratedPlace {
  id: string;
  listKey: string;
  name: string;
  nameEn: string;
  blurb: string;
  blurbEn: string;
  lat: string;
  lon: string;
  country: string;
  isoCountryCode: string;
  sortIdx: string;
}

type ListRow = Omit<CuratedList, "key">;
type PlaceRow = Omit<CuratedPlace, "id">;

const LISTS_CSV_PATH = path.resolve(__dirname, "seedData", "curated_lists.csv");

/**
 * Every file the targets come from, in order.
 *
 * An explicit list, not a glob: a glob would also pick up the backup somebody
 * leaves behind while editing, and seed it. Adding a catalog is one line here
 * plus one row in `curated_lists.csv`.
 *
 * The world-heritage file is GENERATED — see `curated_places.SOURCES.md` and
 * `scripts/build-world-heritage-csv.mjs`. Keeping it separate is what lets it
 * be regenerated wholesale without touching the hand-written wonder rows.
 */
const PLACES_CSV_FILES = ["curated_places.csv", "curated_places.world-heritage.csv"] as const;
const placesCsvPath = (file: string): string => path.resolve(__dirname, "seedData", file);

/** Rows per bulk insert. Keeps a first boot's INSERT off the parameter limit
 *  without turning it back into a round-trip per row. */
const CREATE_CHUNK = 250;

const text = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const sortIndex = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const coordinate = (value: string | undefined, limit: number): number | null => {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return null;
  return parsed;
};

function listDiffers(stored: CuratedList, next: ListRow): boolean {
  return (
    stored.name !== next.name ||
    stored.nameEn !== next.nameEn ||
    stored.description !== next.description ||
    stored.descriptionEn !== next.descriptionEn ||
    stored.icon !== next.icon ||
    stored.sortIdx !== next.sortIdx
  );
}

function placeDiffers(stored: CuratedPlace, next: PlaceRow): boolean {
  return (
    stored.listKey !== next.listKey ||
    stored.name !== next.name ||
    stored.nameEn !== next.nameEn ||
    stored.blurb !== next.blurb ||
    stored.blurbEn !== next.blurbEn ||
    stored.lat !== next.lat ||
    stored.lon !== next.lon ||
    stored.country !== next.country ||
    stored.isoCountryCode !== next.isoCountryCode ||
    stored.sortIdx !== next.sortIdx
  );
}

/**
 * Idempotent seeder for the shipped checklists — `CuratedList` and its
 * `CuratedPlace` targets, from the CSVs beside this file.
 *
 * ## Why this one UPDATES, when ports/ships/chains do not
 *
 * The other catalog seeds carry an empty `update: {}` on purpose: a `Port` row
 * is something the user may have corrected by hand, and re-seeding must not
 * argue with them. A `CuratedPlace` is the opposite kind of row. Nobody can
 * edit it — it is reference data with no user-facing editor — and checklists
 * materialise LAZILY, which means a corrected coordinate here is the ONLY way a
 * fix reaches someone who subscribed a release earlier. An empty `update` would
 * quietly make the catalog un-fixable, which is precisely the failure lazy
 * materialisation exists to avoid.
 *
 * A ticked place is NOT touched by any of this. Ticking copies the target's
 * name and position into the user's own `Place` row at that moment; from then
 * on it is their record, correctable by them and never overwritten from here.
 * So a coordinate fix reaches everyone who has not ticked yet, and leaves alone
 * everyone who has — which is the right split in both directions.
 *
 * ## Writes only what actually changed
 *
 * Both tables are read once and compared field by field, so an unchanged
 * catalog costs two SELECTs and no writes at all — this runs on every boot. The
 * return value is the number of rows WRITTEN, which makes idempotency an
 * observable property (a second run returns 0) rather than a claim.
 *
 * ## Never deletes
 *
 * A row that disappears from the CSV is reported and kept. `Place.curatedItemId`
 * is a plain column with no foreign key, so deleting a target would not cascade
 * — it would silently strand every place a user ticked from it, still in their
 * logbook but missing from the checklist it belongs to. Retiring a list is a
 * migration with a decision behind it, not a side effect of editing a CSV.
 *
 * Content provenance lives in `seedData/curated_places.SOURCES.md`, which the
 * POI design spec (§5) asks for by name: the wonder lists are hand-written and
 * carry no attribution obligation, the world-heritage catalog is generated from
 * Wikidata under CC0. A CSV read with `columns: true` cannot hold a comment
 * header — a leading `#` would become the header row — which is why the record
 * is a sibling file rather than the header the spec imagined.
 */
export async function seedCuratedPlacesFromCSV(): Promise<number> {
  const placesPaths = PLACES_CSV_FILES.map(placesCsvPath).filter((p) => fs.existsSync(p));
  if (!fs.existsSync(LISTS_CSV_PATH) || placesPaths.length === 0) {
    logger.warn({
      operation: "seed_curated_places_skip",
      reason: "csv_missing",
      lists: LISTS_CSV_PATH,
      places: PLACES_CSV_FILES.map(placesCsvPath),
    });
    return 0;
  }
  if (placesPaths.length < PLACES_CSV_FILES.length) {
    // One catalog missing is not a reason to seed none of them, but it IS a
    // reason to say so — a silently absent world-heritage file looks exactly
    // like a checklist nobody has ticked yet.
    logger.warn({
      operation: "seed_curated_places_partial",
      missing: PLACES_CSV_FILES.map(placesCsvPath).filter((p) => !fs.existsSync(p)),
    });
  }

  // `as const` matters: without the literal `columns: true`, csv-parse's
  // overload resolves to `string[][]` and the header row is lost.
  const parseOptions = { columns: true, skip_empty_lines: true, trim: true } as const;
  const listRows = parse(fs.readFileSync(LISTS_CSV_PATH, "utf-8"), parseOptions) as CSVCuratedList[];
  const placeRows = placesPaths.flatMap(
    (file) => parse(fs.readFileSync(file, "utf-8"), parseOptions) as CSVCuratedPlace[]
  );

  const lists = new Map<string, ListRow>();
  for (const row of listRows) {
    const key = row.key?.trim();
    const name = row.name?.trim();
    if (!key || !name) {
      logger.warn({ operation: "seed_curated_lists_malformed_row", key: row.key });
      continue;
    }
    lists.set(key, {
      name,
      nameEn: text(row.nameEn),
      description: text(row.description),
      descriptionEn: text(row.descriptionEn),
      icon: text(row.icon),
      sortIdx: sortIndex(row.sortIdx),
    });
  }

  const places = new Map<string, PlaceRow>();
  for (const row of placeRows) {
    const id = row.id?.trim();
    const listKey = row.listKey?.trim();
    const name = row.name?.trim();
    const lat = coordinate(row.lat, 90);
    const lon = coordinate(row.lon, 180);

    // A target with no position cannot be drawn and cannot be ticked into a
    // `Place` (lat/lon are required there), and an unknown listKey would fail
    // the foreign key mid-run. Both are dropped with a name in the log rather
    // than aborting the seed — one bad row must not cost the other thirteen.
    if (!id || !listKey || !name || lat === null || lon === null) {
      logger.warn({ operation: "seed_curated_places_malformed_row", id: row.id });
      continue;
    }
    if (!lists.has(listKey)) {
      logger.warn({ operation: "seed_curated_places_unknown_list", id, listKey });
      continue;
    }

    places.set(id, {
      listKey,
      name,
      nameEn: text(row.nameEn),
      blurb: text(row.blurb),
      blurbEn: text(row.blurbEn),
      lat,
      lon,
      country: text(row.country),
      isoCountryCode: text(row.isoCountryCode),
      sortIdx: sortIndex(row.sortIdx),
    });
  }

  const [storedLists, storedPlaces] = await Promise.all([
    prisma.curatedList.findMany(),
    prisma.curatedPlace.findMany(),
  ]);
  const storedListByKey = new Map(storedLists.map((l) => [l.key, l]));
  const storedPlaceById = new Map(storedPlaces.map((p) => [p.id, p]));

  let written = 0;

  // Lists first — the places reference them.
  for (const [key, next] of lists) {
    const stored = storedListByKey.get(key);
    if (stored && !listDiffers(stored, next)) continue;
    await prisma.curatedList.upsert({
      where: { key },
      create: { key, ...next },
      update: next,
    });
    written += 1;
  }

  // Two paths on purpose. A first boot inserts ~1250 world-heritage rows, and
  // 1250 round-trips is several seconds of boot; one `createMany` is one. Rows
  // that EXIST and differ still go through `upsert` individually, because
  // `createMany` cannot update and the changed set is normally tiny — a
  // corrected coordinate, not a new catalog.
  const toCreate: CuratedPlace[] = [];
  const toUpdate: Array<[string, PlaceRow]> = [];
  for (const [id, next] of places) {
    const stored = storedPlaceById.get(id);
    if (!stored) {
      toCreate.push({ id, ...next });
    } else if (placeDiffers(stored, next)) {
      toUpdate.push([id, next]);
    }
  }

  for (let i = 0; i < toCreate.length; i += CREATE_CHUNK) {
    const chunk = toCreate.slice(i, i + CREATE_CHUNK);
    // `skipDuplicates` is the safety net for a concurrent boot inserting the
    // same ids between our SELECT and this INSERT — the pre-filter does the
    // work, this just keeps us crash-free.
    const result = await prisma.curatedPlace.createMany({ data: chunk, skipDuplicates: true });
    written += result.count;
  }

  for (const [id, next] of toUpdate) {
    await prisma.curatedPlace.update({ where: { id }, data: next });
    written += 1;
  }

  const retiredLists = storedLists.filter((l) => !lists.has(l.key)).map((l) => l.key);
  const retiredPlaces = storedPlaces.filter((p) => !places.has(p.id)).map((p) => p.id);
  if (retiredLists.length > 0 || retiredPlaces.length > 0) {
    logger.warn({
      operation: "seed_curated_places_retired_rows",
      lists: retiredLists,
      places: retiredPlaces,
      message: "Catalog rows exist in the database but not in the CSV — kept, never deleted",
    });
  }

  logger.info({
    operation: "seed_curated_places_done",
    lists: lists.size,
    places: places.size,
    written,
  });
  return written;
}
