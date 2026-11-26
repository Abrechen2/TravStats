/**
 * Album proposals and the period offer on the trip page (spec 2026-11-26-trip-photo-links.md,
 * decisions 3 and 4). They show as a one-line hint on the trip and NEVER in the inbox; nothing
 * links without the click — except a period under the account's own auto setting (default off).
 *
 * A proposal comes from the preferred source only (PhotoPrism when connected, else Immich), so
 * the same pictures are never proposed twice. It is found by
 *  - `folder`: a PhotoPrism folder whose name carries a word of the trip (`2017_Münster`),
 *  - `name`:   any other collection whose name carries a word of the trip,
 *  - `date`:   a collection filed under the trip's year whose photos fall into the trip's days.
 * A collection named after another year, or whose photos lie wholly outside the trip, is a
 * contradiction and never proposed.
 */
import { prisma } from "../../db";
import { localDay } from "../../shared/time/instant";
import { getCachedAlbumAssets } from "../immich/immichAssetCache";
import { ImmichError, type ImmichErrorKind } from "../immich/types";
import { createPhotoSource, listAllAlbumAssets, type PhotoSourceKind } from "../photoSource";
import { getPhotoSourceConnection } from "../photoSource/connection";
import type { PhotoSourceAlbum, PhotoSourceAsset } from "../photoSource/types";
import { preferredPeriodProvider, tripPeriodContext, type DayRange } from "./periods";

/** Proposals shown at most: it is a hint line, not a picker. */
export const MAX_PROPOSALS = 3;
/** Collections whose photos are read to check the dates; the rest stay unchecked. */
export const MAX_SPAN_CHECKS = 8;
/** A `date` proposal may span the trip plus this many days, so a year album is never one. */
const DATE_SPAN_SLACK_DAYS = 2;
/** The dismissal key of the period offer. */
export const PERIOD_KEY = "period";

const STOP_WORDS = new Set([
  "reise",
  "reisen",
  "trip",
  "urlaub",
  "tour",
  "und",
  "the",
  "and",
  "nach",
  "mit",
  "von",
  "vom",
  "zum",
  "zur",
  "der",
  "die",
  "das",
  "ein",
  "eine",
  "fotos",
  "foto",
  "photos",
  "photo",
  "bilder",
  "bild",
  "album",
  "dienstreise",
  "geschaftsreise",
  "business",
  "work",
  "for",
  "auf",
  "bei",
  "beim",
  "with",
  "from",
]);
const YEAR = /^(19|20)\d{2}$/;
/** Collections that are a calendar slice of the library, never a trip's album. */
const NEVER_PROPOSED = new Set(["month", "state"]);

/** Lower case, no diacritics, umlaut spellings folded (`Münster` = `Muenster`). */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u");
}

export function nameTokens(value: string): { words: string[]; years: number[] } {
  const raw = normalizeName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return {
    words: raw.filter(
      (t) => t.length >= 3 && !YEAR.test(t) && !/^\d+$/.test(t) && !STOP_WORDS.has(t)
    ),
    years: raw.filter((t) => YEAR.test(t)).map(Number),
  };
}

export interface TripForMatch {
  name: string;
  destinationLabel: string | null;
  days: DayRange | null;
}

export type ProposalReason = "folder" | "name" | "date";

const yearsOf = (days: DayRange | null): number[] =>
  days === null
    ? []
    : Array.from(
        { length: Number(days.until.slice(0, 4)) - Number(days.from.slice(0, 4)) + 1 },
        (_, i) => Number(days.from.slice(0, 4)) + i
      );

/**
 * The name side of a match: the reason a collection is a candidate, or null. Pure — the date
 * side (`overlapDays`) needs the collection's photos and is checked afterwards.
 */
export function matchAlbumName(trip: TripForMatch, album: PhotoSourceAlbum): ProposalReason | null {
  if (album.kind && NEVER_PROPOSED.has(album.kind)) return null;
  const tripWords = nameTokens(`${trip.name} ${trip.destinationLabel ?? ""}`).words;
  const albumTokens = nameTokens(album.albumName);
  const tripYears = yearsOf(trip.days);
  const albumYears = [...albumTokens.years, ...(album.year ? [album.year] : [])];
  // Named or filed under another year: a different visit to the same place.
  if (
    tripYears.length > 0 &&
    albumYears.length > 0 &&
    !albumYears.some((y) => tripYears.includes(y))
  )
    return null;
  const nameHit = albumTokens.words.some((w) =>
    tripWords.some((t) => w === t || (t.length >= 5 && w.startsWith(t)))
  );
  if (nameHit) return album.kind === "folder" ? "folder" : "name";
  return albumYears.length > 0 && tripYears.length > 0 ? "date" : null;
}

const dayCount = (from: string, until: string): number =>
  Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Days of the photos' span inside the trip, and the span's own length; null without dated photos. */
export function spanOverlap(
  assets: readonly Pick<PhotoSourceAsset, "fileCreatedAt" | "type">[],
  days: DayRange,
  zone: string
): { overlapDays: number; spanDays: number } | null {
  const dated = assets
    .filter(
      (a) => a.type === "IMAGE" && a.fileCreatedAt && Number.isFinite(Date.parse(a.fileCreatedAt))
    )
    .map((a) => localDay(a.fileCreatedAt!, zone))
    .sort();
  if (dated.length === 0) return null;
  const first = dated[0];
  const last = dated[dated.length - 1];
  const from = first > days.from ? first : days.from;
  const until = last < days.until ? last : days.until;
  return { overlapDays: until < from ? 0 : dayCount(from, until), spanDays: dayCount(first, last) };
}

export interface AlbumProposalDto {
  /** Dismissal key: `<provider>:<albumId>`. */
  key: string;
  /** The connection the album lives in; today the provider (one connection per provider). */
  connectionId: PhotoSourceKind;
  albumId: string;
  name: string;
  count: number | null;
  /** Days the album's photos share with the trip; null when its dates were not read. */
  overlapDays: number | null;
  reason: ProposalReason;
}

export interface PeriodOfferDto {
  connectionId: PhotoSourceKind;
  from: string;
  until: string;
}

export interface TripPhotoProposals {
  /** The source proposals come from; null when the account has no photo source. */
  connectionId: PhotoSourceKind | null;
  proposals: AlbumProposalDto[];
  /** "Zeitraum verknüpfen" for a business trip with no album; null otherwise. */
  periodOffer: PeriodOfferDto | null;
  /** A period was just linked by the account's auto setting. */
  autoLinked: boolean;
  /** Why the source could not be read; null when it could. */
  failure: ImmichErrorKind | null;
}

const RANK: Record<ProposalReason, number> = { folder: 0, name: 1, date: 2 };

async function findProposals(
  userId: string,
  provider: PhotoSourceKind,
  trip: TripForMatch & { id: string },
  zone: string
): Promise<AlbumProposalDto[]> {
  const conn = await getPhotoSourceConnection(provider, userId);
  if (conn === null) return [];
  const source = createPhotoSource(provider, conn);
  const [albums, linked, dismissed] = await Promise.all([
    source.listAlbums(),
    prisma.tripImmichAlbum.findMany({
      where: { tripId: trip.id, provider },
      select: { immichAlbumId: true },
    }),
    prisma.tripPhotoProposalDismissal.findMany({
      where: { tripId: trip.id, provider },
      select: { albumId: true },
    }),
  ]);
  const skip = new Set([...linked.map((l) => l.immichAlbumId), ...dismissed.map((d) => d.albumId)]);
  const candidates = albums
    .filter((a) => !skip.has(a.id))
    .map((album) => ({ album, reason: matchAlbumName(trip, album) }))
    .filter((c): c is { album: PhotoSourceAlbum; reason: ProposalReason } => c.reason !== null)
    .sort(
      (a, b) =>
        RANK[a.reason] - RANK[b.reason] || a.album.albumName.localeCompare(b.album.albumName)
    )
    .slice(0, MAX_SPAN_CHECKS);

  const checked: AlbumProposalDto[] = [];
  for (const { album, reason } of candidates) {
    let overlap: { overlapDays: number; spanDays: number } | null = null;
    let count = album.assetCount;
    if (trip.days !== null) {
      try {
        const assets = await getCachedAlbumAssets(
          userId,
          album.id,
          () => listAllAlbumAssets(source, album.id),
          provider
        );
        overlap = spanOverlap(assets, trip.days, zone);
        count = count ?? assets.filter((a) => a.type === "IMAGE").length;
      } catch (error) {
        if (!(error instanceof ImmichError)) throw error;
        // The name still speaks for the album; only its dates stay unknown.
        if (reason === "date") continue;
      }
    }
    if (overlap !== null && overlap.overlapDays === 0) continue;
    if (reason === "date") {
      if (overlap === null || trip.days === null) continue;
      if (overlap.spanDays > dayCount(trip.days.from, trip.days.until) + DATE_SPAN_SLACK_DAYS)
        continue;
    }
    checked.push({
      key: `${provider}:${album.id}`,
      connectionId: provider,
      albumId: album.id,
      name: album.albumName,
      count,
      overlapDays: overlap?.overlapDays ?? null,
      reason,
    });
  }
  return checked
    .sort((a, b) => RANK[a.reason] - RANK[b.reason] || (b.overlapDays ?? 0) - (a.overlapDays ?? 0))
    .slice(0, MAX_PROPOSALS);
}

/**
 * Proposals and the period offer for the caller's trip; null when the trip is not theirs.
 * With the auto setting on, a trip that has no album, no period and no proposal gets its
 * period linked here — the first time its page asks — unless the user removed one before.
 */
export async function loadTripPhotoProposals(
  userId: string,
  tripId: string
): Promise<TripPhotoProposals | null> {
  const ctx = await tripPeriodContext(userId, tripId);
  if (ctx === null) return null;
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { name: true, destinationLabel: true, category: true },
  });
  const provider = await preferredPeriodProvider(userId);
  const empty: TripPhotoProposals = {
    connectionId: provider,
    proposals: [],
    periodOffer: null,
    autoLinked: false,
    failure: null,
  };
  if (provider === null) return empty;

  let proposals: AlbumProposalDto[];
  try {
    proposals = await findProposals(
      userId,
      provider,
      { id: tripId, name: trip.name, destinationLabel: trip.destinationLabel, days: ctx.tripDays },
      ctx.zone
    );
  } catch (error) {
    if (!(error instanceof ImmichError)) throw error;
    return { ...empty, failure: error.kind };
  }

  const [albumLinks, periods, periodDismissed, settings] = await Promise.all([
    prisma.tripImmichAlbum.count({ where: { tripId } }),
    prisma.tripPhotoPeriod.count({ where: { tripId } }),
    prisma.tripPhotoProposalDismissal.count({ where: { tripId, albumId: PERIOD_KEY } }),
    prisma.userSettings.findUnique({ where: { userId }, select: { photoPeriodAutoLink: true } }),
  ]);
  const open =
    ctx.tripDays !== null &&
    proposals.length === 0 &&
    albumLinks === 0 &&
    periods === 0 &&
    periodDismissed === 0;
  if (!open || ctx.tripDays === null) return { ...empty, proposals };

  if (settings?.photoPeriodAutoLink === true) {
    await prisma.tripPhotoPeriod.createMany({
      data: [{ tripId, provider, auto: true }],
      skipDuplicates: true,
    });
    return { ...empty, autoLinked: true };
  }
  if (trip.category === "business") {
    return {
      ...empty,
      periodOffer: { connectionId: provider, from: ctx.tripDays.from, until: ctx.tripDays.until },
    };
  }
  return empty;
}
