import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import { NOT_A_COVER } from "../trips/photoStation";
import { toKind } from "../photoLinking/entryPhotos";

/** A photo taken this far from every station is not "on the roadtrip" (km). */
export const ROADTRIP_PHOTO_CORRIDOR_KM = 10;
/** Linked photos listed at most; a roadtrip with more is cut, and says so. */
export const ROADTRIP_LINKED_CAP = 600;
/** Unlinked uploads offered at most. */
export const ROADTRIP_WINDOW_CAP = 200;
/** Local calendar days and instants disagree by up to a day's worth of zone offset. */
const SPAN_SLACK_MS = 14 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RoadtripPhotoSource = "upload" | "immich" | "photoprism";

export interface RoadtripPhotoDto {
  /** Unique across sources and ways of linking. */
  key: string;
  /** `linked`: filed at a station, a stay or a visit. `window`: only fits the time and place. */
  kind: "linked" | "window";
  source: RoadtripPhotoSource;
  /** How a linked photo came to belong here. */
  via: "station" | "stay" | "visit" | "upload";
  url: string;
  caption: string | null;
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
  /** The calendar day it is grouped under: the station's day, else the day it was taken. */
  day: string | null;
  stationId: string | null;
  stationTitle: string | null;
  /** Window uploads only: what a one-click link needs. */
  tripId: string | null;
  tripPhotoId: string | null;
}

export interface RoadtripPhotos {
  photos: RoadtripPhotoDto[];
  /** First and last day the stations cover; null when no station is dated. */
  span: { from: string; to: string } | null;
  stations: Array<{ id: string; title: string; day: string | null }>;
  /** More linked photos exist than `photos` holds. */
  truncated: boolean;
}

const dayOf = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Every photo that belongs to the caller's roadtrip, or null when it is not theirs.
 *
 * Linked: filed at a station (an upload's `stopId`, a library link), at the stay a station
 * slept in, or at a visit of a station's place on the roadtrip's trip. Window: the trip's
 * uploads that are not filed anywhere and were taken inside the roadtrip's days within
 * {@link ROADTRIP_PHOTO_CORRIDOR_KM} of a station. A photo with no position is never
 * offered by the window: "near the route" cannot be answered for it, and a guess would put
 * strangers' pictures on the page. Everything is scoped to the caller twice — the route's
 * owner and the owner of each photo's trip or link row.
 */
export async function loadRoadtripPhotos(
  userId: string,
  roadtripId: string
): Promise<RoadtripPhotos | null> {
  const route = await prisma.tripRoute.findFirst({
    where: { id: roadtripId, userId, kind: "roadtrip" },
    select: { id: true, tripId: true },
  });
  if (!route) return null;

  const stations = await prisma.tripStop.findMany({
    where: { routeId: route.id, viaPoint: false },
    orderBy: { routeOrderIdx: "asc" },
    select: {
      id: true,
      title: true,
      lat: true,
      lon: true,
      startDate: true,
      endDate: true,
      lodgingStayId: true,
      placeId: true,
    },
  });
  const stationIds = stations.map((s) => s.id);
  const stationOf = new Map(stations.map((s) => [s.id, s]));
  const stationOfStay = new Map(
    stations.flatMap((s) => (s.lodgingStayId ? [[s.lodgingStayId, s] as const] : []))
  );
  const dated = stations.filter((s) => s.startDate);
  const first = dated.length > 0 ? Math.min(...dated.map((s) => s.startDate!.getTime())) : null;
  const last =
    dated.length > 0 ? Math.max(...dated.map((s) => (s.endDate ?? s.startDate)!.getTime())) : null;
  const span =
    first !== null && last !== null
      ? {
          from: new Date(first).toISOString().slice(0, 10),
          to: new Date(last).toISOString().slice(0, 10),
        }
      : null;

  const out: RoadtripPhotoDto[] = [];
  const place = (s: (typeof stations)[number] | undefined) => ({
    stationId: s?.id ?? null,
    stationTitle: s?.title ?? null,
  });

  if (stationIds.length > 0) {
    const uploads = await prisma.tripPhoto.findMany({
      where: { stopId: { in: stationIds }, trip: { userId }, ...NOT_A_COVER },
      orderBy: [{ takenAt: "asc" }, { sortIdx: "asc" }],
      take: ROADTRIP_LINKED_CAP + 1,
    });
    for (const p of uploads) {
      const s = stationOf.get(p.stopId!);
      out.push({
        key: `upload:${p.id}`,
        kind: "linked",
        source: "upload",
        via: "station",
        url: `/api/v1/trips/${p.tripId}/photos/${p.id}/file`,
        caption: p.caption,
        takenAt: p.takenAt?.toISOString() ?? null,
        lat: p.lat,
        lon: p.lon,
        day: dayOf(s?.startDate ?? null) ?? dayOf(p.takenAt),
        ...place(s),
        tripId: p.tripId,
        tripPhotoId: p.id,
      });
    }
  }

  const stayIds = [...stationOfStay.keys()];
  if (stationIds.length > 0 || stayIds.length > 0) {
    const links = await prisma.entryPhotoLink.findMany({
      where: {
        userId,
        refused: false,
        OR: [{ tripStopId: { in: stationIds } }, { lodgingStayId: { in: stayIds } }],
      },
      orderBy: [{ takenAt: "asc" }, { createdAt: "asc" }],
      take: ROADTRIP_LINKED_CAP + 1,
    });
    for (const l of links) {
      const viaStay = l.tripStopId === null && l.lodgingStayId !== null;
      const s = viaStay ? stationOfStay.get(l.lodgingStayId!) : stationOf.get(l.tripStopId!);
      const base = viaStay
        ? `/api/v1/entry-photos/stay/${l.lodgingStayId}`
        : `/api/v1/entry-photos/roadtripStop/${l.tripStopId}`;
      out.push({
        key: `link:${l.id}`,
        kind: "linked",
        source: toKind(l.provider),
        via: viaStay ? "stay" : "station",
        url: `${base}/photos/${l.id}/file`,
        caption: null,
        takenAt: l.takenAt?.toISOString() ?? null,
        lat: null,
        lon: null,
        day: dayOf(s?.startDate ?? null) ?? dayOf(l.takenAt),
        ...place(s),
        tripId: null,
        tripPhotoId: null,
      });
    }
  }

  const placeIds = [...new Set(stations.flatMap((s) => (s.placeId ? [s.placeId] : [])))];
  if (route.tripId && placeIds.length > 0) {
    const visitPhotos = await prisma.placeVisitPhoto.findMany({
      where: { visit: { userId, tripId: route.tripId, placeId: { in: placeIds } } },
      include: { visit: { select: { id: true, placeId: true, visitedAt: true } } },
      orderBy: [{ createdAt: "asc" }],
      take: ROADTRIP_LINKED_CAP + 1,
    });
    for (const v of visitPhotos) {
      const s = stations.find((x) => x.placeId === v.visit.placeId);
      out.push({
        key: `visit:${v.id}`,
        kind: "linked",
        source: v.immichAssetId ? toKind(v.provider) : "upload",
        via: "visit",
        url: `/api/v1/places/visits/${v.visit.id}/photos/${v.id}/file`,
        caption: v.caption,
        takenAt: v.takenAt?.toISOString() ?? null,
        lat: null,
        lon: null,
        day: dayOf(s?.startDate ?? null) ?? dayOf(v.visit.visitedAt),
        ...place(s),
        tripId: null,
        tripPhotoId: null,
      });
    }
  }

  const truncated = out.length > ROADTRIP_LINKED_CAP;
  const linked = out.slice(0, ROADTRIP_LINKED_CAP);

  const window =
    route.tripId && first !== null && last !== null
      ? await windowUploads(userId, route.tripId, stations, first, last)
      : [];

  return {
    photos: [...linked, ...window].sort(
      (a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? "") || a.key.localeCompare(b.key)
    ),
    span,
    stations: stations.map((s) => ({ id: s.id, title: s.title, day: dayOf(s.startDate) })),
    truncated,
  };
}

async function windowUploads(
  userId: string,
  tripId: string,
  stations: Array<{ id: string; title: string; lat: number | null; lon: number | null }>,
  first: number,
  last: number
): Promise<RoadtripPhotoDto[]> {
  const anchors = stations.filter((s) => s.lat !== null && s.lon !== null);
  if (anchors.length === 0) return [];
  const rows = await prisma.tripPhoto.findMany({
    where: {
      tripId,
      trip: { userId },
      stopId: null,
      lat: { not: null },
      lon: { not: null },
      takenAt: {
        gte: new Date(first - SPAN_SLACK_MS),
        lt: new Date(last + DAY_MS + SPAN_SLACK_MS),
      },
      ...NOT_A_COVER,
    },
    orderBy: { takenAt: "asc" },
    take: ROADTRIP_WINDOW_CAP * 3,
  });
  const out: RoadtripPhotoDto[] = [];
  for (const p of rows) {
    let nearest: (typeof anchors)[number] | null = null;
    let best = Infinity;
    for (const a of anchors) {
      const km = haversineKm({ lat: p.lat!, lon: p.lon! }, { lat: a.lat!, lon: a.lon! });
      if (km < best) {
        best = km;
        nearest = a;
      }
    }
    if (!nearest || best > ROADTRIP_PHOTO_CORRIDOR_KM) continue;
    out.push({
      key: `window:${p.id}`,
      kind: "window",
      source: "upload",
      via: "upload",
      url: `/api/v1/trips/${p.tripId}/photos/${p.id}/file`,
      caption: p.caption,
      takenAt: p.takenAt?.toISOString() ?? null,
      lat: p.lat,
      lon: p.lon,
      day: dayOf(p.takenAt),
      stationId: nearest.id,
      stationTitle: nearest.title,
      tripId: p.tripId,
      tripPhotoId: p.id,
    });
    if (out.length >= ROADTRIP_WINDOW_CAP) break;
  }
  return out;
}
