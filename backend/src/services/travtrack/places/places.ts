import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { AppError } from "../../../middleware/errorHandler";
import { PLACE_RADIUS_DEFAULT_M, fixedPlaceWindowSchema } from "../../../schemas/travtrackPlaces";
import { dayAnchorNow } from "../../../shared/time/clock";
import { localDay } from "../../../shared/time/instant";
import { toDbDate } from "../../../shared/time/localDate";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { zoneOf } from "../../../shared/time/zoneOf";
import { stayNamesExactDays } from "../../../shared/lodgingTiming";
import { deriveHomePlaceAt } from "../../home/homePlace";
import { ENTRY_WINDOW_ADAPTERS } from "../../locationEvidence/journeys/entryWindows";
import type { FoldContext, FoldLodging, FoldPlace } from "../legs/fold";
import type { Span } from "../readSafe";
import type { FixedPlaceWindow } from "./window";

/**
 * Fixed places (spec 2026-11-05-travtrack-fixed-places, S2). `home` is never a
 * row: its point is the home the server already knows, read for the day
 * shown, and only its radius and window live in `travtrack_place_settings`.
 */

export const HOME_ID = "home";

export type FixedPlaceKind = "home" | "work" | "custom";

export type FixedPlace = {
  id: string;
  name: string;
  kind: FixedPlaceKind;
  lat: number | null;
  lon: number | null;
  radiusM: number;
  window: FixedPlaceWindow | null;
};

export type LodgingSetting = { enabled: boolean; radiusM: number };

export type PlaceBody = {
  name: string;
  kind: "work" | "custom";
  lat: number;
  lon: number;
  radiusM: number;
  window: FixedPlaceWindow | null;
};

const notFound = () => new AppError("Fixed place not found", 404, "TRAVTRACK_PLACE_NOT_FOUND");

/** A stored window, or null when what is stored is not one (read leniently, never trusted). */
function windowOf(raw: unknown): FixedPlaceWindow | null {
  const parsed = fixedPlaceWindowSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const asJson = (w: FixedPlaceWindow | null) =>
  w === null ? Prisma.JsonNull : (w as unknown as Prisma.InputJsonValue);

async function settingsOf(userId: string) {
  const row = await prisma.travTrackPlaceSettings.findUnique({ where: { userId } });
  return {
    homeRadiusM: row?.homeRadiusM ?? PLACE_RADIUS_DEFAULT_M,
    homeWindow: windowOf(row?.homeWindow),
    lodging: {
      enabled: row?.lodgingEnabled ?? false,
      radiusM: row?.lodgingRadiusM ?? PLACE_RADIUS_DEFAULT_M,
    } satisfies LodgingSetting,
  };
}

/** The home entry on `day`: the home valid then, with the stored radius and window. */
async function homeEntry(
  userId: string,
  day: string,
  settings: Awaited<ReturnType<typeof settingsOf>>
): Promise<FixedPlace> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true, homePlace: true },
  });
  const home = await deriveHomePlaceAt(row, day);
  return {
    id: HOME_ID,
    name: home?.name ?? "",
    kind: "home",
    lat: home?.lat ?? null,
    lon: home?.lon ?? null,
    radiusM: settings.homeRadiusM,
    window: settings.homeWindow,
  };
}

const toFixedPlace = (r: {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  radiusM: number;
  window: unknown;
}): FixedPlace => ({
  id: r.id,
  name: r.name,
  kind: r.kind === "work" ? "work" : "custom",
  lat: r.lat,
  lon: r.lon,
  radiusM: r.radiusM,
  window: windowOf(r.window),
});

async function today(userId: string): Promise<string> {
  const { zone } = await profileZoneOf(userId);
  return localDay(dayAnchorNow(zone), zone);
}

/** Current and upcoming bookings (day precision) whose house has no coordinates: they cannot fold. */
async function lodgingSkipped(userId: string, day: string): Promise<number> {
  return prisma.lodgingStay.count({
    where: {
      userId,
      status: { not: "cancelled" },
      datePrecision: "DAY",
      checkOutDate: { gte: toDbDate(day) },
      lodging: { OR: [{ lat: null }, { lon: null }] },
    },
  });
}

export async function listPlaces(userId: string) {
  const day = await today(userId);
  const [settings, rows, skipped] = await Promise.all([
    settingsOf(userId),
    prisma.travTrackFixedPlace.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    lodgingSkipped(userId, day),
  ]);
  return {
    places: [await homeEntry(userId, day, settings), ...rows.map(toFixedPlace)],
    lodgingAsPlace: settings.lodging,
    lodgingSkipped: skipped,
  };
}

export async function createPlace(userId: string, body: PlaceBody): Promise<FixedPlace> {
  const row = await prisma.travTrackFixedPlace.create({
    data: { userId, ...body, window: asJson(body.window) },
  });
  return toFixedPlace(row);
}

export async function updatePlace(
  userId: string,
  id: string,
  body: PlaceBody
): Promise<FixedPlace> {
  const found = await prisma.travTrackFixedPlace.findFirst({ where: { id, userId } });
  if (!found) throw notFound();
  const row = await prisma.travTrackFixedPlace.update({
    where: { id },
    data: { ...body, window: asJson(body.window) },
  });
  return toFixedPlace(row);
}

export async function deletePlace(userId: string, id: string): Promise<void> {
  const { count } = await prisma.travTrackFixedPlace.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound();
}

export async function updateHome(
  userId: string,
  body: { radiusM: number; window: FixedPlaceWindow | null }
): Promise<FixedPlace> {
  const data = { homeRadiusM: body.radiusM, homeWindow: asJson(body.window) };
  await prisma.travTrackPlaceSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return homeEntry(userId, await today(userId), await settingsOf(userId));
}

export async function setLodgingSetting(
  userId: string,
  body: LodgingSetting
): Promise<LodgingSetting> {
  const data = { lodgingEnabled: body.enabled, lodgingRadiusM: body.radiusM };
  await prisma.travTrackPlaceSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return body;
}

/** A place's zone for its window; resolved only when it has one (a window is read in the place's zone). */
const zoneForWindow = (p: { lat: number; lon: number }, window: FixedPlaceWindow | null) =>
  window === null ? null : zoneOf({ lat: p.lat, lon: p.lon });

async function lodgingsIn(userId: string, window: Span, radiusM: number): Promise<FoldLodging[]> {
  const adapter = ENTRY_WINDOW_ADAPTERS.lodging;
  if ("none" in adapter) return [];
  const entries = await adapter.read(userId, window);
  if (entries.length === 0) return [];
  const stays = await prisma.lodgingStay.findMany({
    where: { userId, id: { in: entries.map((e) => e.id) } },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      datePrecision: true,
      nights: true,
      lodging: { select: { name: true, lat: true, lon: true } },
    },
  });
  const byId = new Map(stays.map((s) => [s.id, s]));
  return entries.flatMap((e): FoldLodging[] => {
    const s = byId.get(e.id);
    // Day precision only: a month- or year-precision stay holds placeholder dates, not a span.
    if (!s || !stayNamesExactDays(s)) return [];
    if (s.lodging.lat === null || s.lodging.lon === null) return [];
    return [
      {
        stayId: s.id,
        name: s.lodging.name,
        lat: s.lodging.lat,
        lon: s.lodging.lon,
        radiusM,
        fromMs: e.fromMs,
        untilMs: e.untilMs,
      },
    ];
  });
}

/** What a day folds into: its fixed places (home as valid that day) and, if enabled, its bookings. */
export async function foldContextFor(
  userId: string,
  window: Span,
  day: string
): Promise<FoldContext> {
  const [settings, rows] = await Promise.all([
    settingsOf(userId),
    prisma.travTrackFixedPlace.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);
  const home = await homeEntry(userId, day, settings);
  const places: FoldPlace[] = [];
  if (home.lat !== null && home.lon !== null) {
    places.push({
      id: HOME_ID,
      name: home.name,
      kind: "home",
      lat: home.lat,
      lon: home.lon,
      radiusM: home.radiusM,
      window: home.window,
      zone: zoneForWindow({ lat: home.lat, lon: home.lon }, home.window),
    });
  }
  for (const r of rows.map(toFixedPlace)) {
    places.push({
      id: r.id,
      name: r.name,
      kind: r.kind,
      lat: r.lat!,
      lon: r.lon!,
      radiusM: r.radiusM,
      window: r.window,
      zone: zoneForWindow({ lat: r.lat!, lon: r.lon! }, r.window),
    });
  }
  const lodgings = settings.lodging.enabled
    ? await lodgingsIn(userId, window, settings.lodging.radiusM)
    : [];
  return { places, lodgings };
}
