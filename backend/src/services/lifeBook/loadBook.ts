import { prisma } from "../../db";
import {
  airportFactsFor,
  cruiseCountriesByTrip,
  lodgingCountriesByTrip,
  placeCountriesByTrip,
  rideCountriesByTrip,
  roadtripCountriesByTrip,
  tripCountries,
} from "../../routes/trips/tripCountries";
import { getPlacePhotoDir, getTripPhotoDir } from "../../middleware/upload";
import { LINK_COLUMN, loadEntries, type RawEntry } from "./entries";
import { PhotoLoader } from "./images";
import type { BookEntry, BookLang, BookPhoto, BookTrip, DocKind } from "./types";

export type BookScope =
  { kind: "all" } | { kind: "year"; year: number } | { kind: "trip"; tripId: string };

/** Photographs per trip in total, trip photos and visit photos together. */
export const TRIP_PHOTO_BUDGET = 24;
const TRIP_PHOTOS_CAP = 12;
const VISIT_PHOTOS_CAP = 3;

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const DOC_KINDS: readonly string[] = ["invoice", "booking", "boardingPass", "ticket", "other"];
const asKind = (k: string | null): DocKind =>
  DOC_KINDS.includes(k ?? "") ? (k as DocKind) : "other";

export interface TripMeta {
  id: string;
  name: string;
  startDay: string | null;
}

/** The trips in scope, oldest first; undated trips follow, by name. Own account only. */
export async function listScopeTrips(userId: string, scope: BookScope): Promise<TripMeta[]> {
  const rows = await prisma.trip.findMany({
    where: { userId, ...(scope.kind === "trip" ? { id: scope.tripId } : {}) },
    select: { id: true, name: true, startDay: true, startDate: true },
  });
  const metas = rows.map((t) => {
    const d = t.startDay ?? t.startDate;
    return { id: t.id, name: t.name, startDay: d ? isoDay(d) : null };
  });
  const inScope =
    scope.kind === "year" ? metas.filter((t) => t.startDay?.startsWith(`${scope.year}-`)) : metas;
  return inScope.sort(
    (a, b) =>
      (a.startDay ?? "9999").localeCompare(b.startDay ?? "9999") ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
  );
}

/** Documents linked to each entry: the kinds only, never file names. */
async function attachEvidence(items: RawEntry[]): Promise<void> {
  const byColumn = new Map<string, Map<string, BookEntry>>();
  for (const { entry, dbId } of items) {
    const col = LINK_COLUMN[entry.kind];
    if (!col) continue;
    const m = byColumn.get(col) ?? new Map<string, BookEntry>();
    m.set(dbId, entry);
    byColumn.set(col, m);
  }
  if (byColumn.size === 0) return;
  const links = await prisma.documentLink.findMany({
    where: { OR: [...byColumn].map(([col, m]) => ({ [col]: { in: [...m.keys()] } })) },
    select: {
      flightId: true,
      railJourneyId: true,
      busJourneyId: true,
      ferryJourneyId: true,
      rentalBookingId: true,
      cruiseId: true,
      lodgingStayId: true,
      placeVisitId: true,
      document: { select: { kind: true } },
    },
  });
  for (const link of links) {
    for (const [col, m] of byColumn) {
      const id = (link as unknown as Record<string, string | null>)[col];
      const entry = id ? m.get(id) : undefined;
      if (entry) entry.evidence.push(asKind(link.document.kind));
    }
  }
  for (const { entry } of items) entry.evidence = [...new Set(entry.evidence)];
}

/** Visit photographs (manual before auto, 3 per visit) and trip photographs, within one budget. */
async function loadPhotos(
  userId: string,
  tripId: string,
  items: RawEntry[],
  loader: PhotoLoader
): Promise<BookPhoto[]> {
  let left = TRIP_PHOTO_BUDGET;
  const visitIds = items.filter((i) => i.entry.kind === "visit").map((i) => i.dbId);
  const byVisit = new Map(items.map((i) => [i.dbId, i.entry]));
  const visitPhotos = visitIds.length
    ? await prisma.placeVisitPhoto.findMany({
        where: { placeVisitId: { in: visitIds }, visit: { userId } },
        include: { tripPhoto: { select: { filename: true, mimetype: true } } },
        orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  const perVisit = new Map<string, number>();
  const ordered = [
    ...visitPhotos.filter((p) => p.provenance !== "auto"),
    ...visitPhotos.filter((p) => p.provenance === "auto"),
  ];
  for (const p of ordered) {
    const entry = byVisit.get(p.placeVisitId);
    if (!entry || left <= 0 || (perVisit.get(p.placeVisitId) ?? 0) >= VISIT_PHOTOS_CAP) continue;
    let dataUri: string | null = null;
    if (p.filename) dataUri = await loader.fromDisk(getPlacePhotoDir(), p.filename, p.mimetype);
    else if (p.tripPhoto?.filename)
      dataUri = await loader.fromDisk(
        getTripPhotoDir(),
        p.tripPhoto.filename,
        p.tripPhoto.mimetype
      );
    else if (p.immichAssetId) dataUri = await loader.fromLibrary(p.provider, p.immichAssetId);
    if (!dataUri) continue;
    perVisit.set(p.placeVisitId, (perVisit.get(p.placeVisitId) ?? 0) + 1);
    left--;
    entry.photos.push({
      dataUri,
      caption: p.caption,
      takenDay: p.takenAt ? isoDay(p.takenAt) : null,
    });
  }

  const tripPhotos = await prisma.tripPhoto.findMany({
    where: { tripId, trip: { userId } },
    orderBy: [{ sortIdx: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: TRIP_PHOTOS_CAP * 2,
  });
  const out: BookPhoto[] = [];
  for (const p of tripPhotos) {
    if (left <= 0 || out.length >= TRIP_PHOTOS_CAP) break;
    const dataUri = p.filename
      ? await loader.fromDisk(getTripPhotoDir(), p.filename, p.mimetype)
      : p.immichAssetId
        ? await loader.fromLibrary(p.provider, p.immichAssetId)
        : null;
    if (!dataUri) continue;
    left--;
    out.push({ dataUri, caption: p.caption, takenDay: p.takenAt ? isoDay(p.takenAt) : null });
  }
  return out;
}

export async function buildTrip(
  userId: string,
  username: string,
  meta: TripMeta,
  lang: BookLang,
  loader: PhotoLoader
): Promise<BookTrip> {
  const trip = await prisma.trip.findFirstOrThrow({
    where: { id: meta.id, userId },
    include: {
      companionLinks: {
        orderBy: { position: "asc" },
        include: { companion: { select: { displayName: true } } },
      },
    },
  });
  const loaded = await loadEntries(userId, trip.id, lang);
  await attachEvidence(loaded.items);
  const photos = await loadPhotos(userId, trip.id, loaded.items, loader);

  const [facts, cruise, lodging, roadtrip, ride, place, tripDocs] = await Promise.all([
    airportFactsFor(loaded.flights),
    cruiseCountriesByTrip([trip.id]),
    lodgingCountriesByTrip([trip.id]),
    roadtripCountriesByTrip([trip.id]),
    rideCountriesByTrip([trip.id]),
    placeCountriesByTrip([trip.id]),
    prisma.documentLink.findMany({
      where: { tripId: trip.id },
      select: { document: { select: { kind: true } } },
    }),
  ]);
  const countries = tripCountries(
    trip.countries,
    loaded.flights,
    facts,
    cruise.get(trip.id) ?? [],
    lodging.get(trip.id) ?? [],
    roadtrip.get(trip.id) ?? [],
    ride.get(trip.id) ?? [],
    place.get(trip.id) ?? []
  );
  const end = trip.endDay ?? trip.endDate;
  return {
    id: trip.id,
    name: trip.name,
    startDay: meta.startDay,
    endDay: end ? isoDay(end) : null,
    countries,
    travellers: [
      ...new Set([
        username,
        ...trip.companionLinks.map((l) => l.companion.displayName),
        ...trip.companions,
      ]),
    ],
    description: trip.description,
    notes: trip.notes,
    evidence: [...new Set(tripDocs.map((d) => asKind(d.document.kind)))],
    entries: loaded.items.map((i) => i.entry),
    photos,
    points: loaded.points,
    legs: loaded.legs,
  };
}

/** Entries with no trip, for the `all` and `year` scopes. Undated ones only count in `all`. */
export async function buildLoose(
  userId: string,
  scope: BookScope,
  lang: BookLang
): Promise<BookEntry[]> {
  const loaded = await loadEntries(userId, null, lang);
  await attachEvidence(loaded.items);
  const entries = loaded.items.map((i) => i.entry);
  if (scope.kind !== "year") return entries;
  return entries.filter((e) => e.day?.startsWith(`${scope.year}-`));
}
