import { prisma } from "../db";
import { recomputeLegs, type StopCoords } from "../services/tour/legRecompute";
import { autoRouteNewLegs } from "../services/tour/routing/autoRouteLegs";
import { parseTrackFile } from "../services/tour/tracks/parseTrackFile";
import { ingestTrack } from "../services/tour/tracks/ingestTrack";
import { ingestedTrackColumns } from "../services/tour/tracks/trackRow";

/**
 * Demo data for roadtrips and day tours (owner, 2026-09-24): two roadtrips
 * with stations, free nights and stays; day tours hanging at stations, one
 * with a recording and one planned only; a standalone bike tour; and a trip
 * with journal entries whose day's weather open data can fill.
 *
 * Everything carries the prefix "Demo:" and is removed before it is written
 * again, so the seed can be re-run on the same account. It goes through the
 * service layer, not HTTP: the shared demo account refuses writes by design,
 * and seeding it is what the demo seeds are for.
 */

export const DEMO_PREFIX = "Demo: ";
const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

interface StationSpec {
  title: string;
  lat: number;
  lon: number;
  start: string;
  end?: string;
  night: "pass" | "free" | { stayId: string };
}

async function removePrevious(userId: string): Promise<void> {
  const routes = await prisma.tripRoute.findMany({
    where: { userId, name: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const ids = routes.map((r) => r.id);
  // Stations and points belong to their route; a trip's stops to their trip.
  await prisma.tripStop.deleteMany({ where: { routeId: { in: ids }, tripId: null } });
  await prisma.tripRoute.deleteMany({ where: { id: { in: ids } } });
  await prisma.trip.deleteMany({ where: { userId, name: { startsWith: DEMO_PREFIX } } });
  await prisma.lodging.deleteMany({ where: { userId, name: { startsWith: DEMO_PREFIX } } });
}

async function stay(
  userId: string,
  name: string,
  type: string,
  at: { lat: number; lon: number; city: string; country: string; iso: string },
  checkIn: string,
  checkOut: string
): Promise<string> {
  const lodging = await prisma.lodging.create({
    data: {
      userId,
      type,
      name: `${DEMO_PREFIX}${name}`,
      lat: at.lat,
      lon: at.lon,
      city: at.city,
      country: at.country,
      isoCountryCode: at.iso,
      visited: true,
    },
  });
  const s = await prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: lodging.id,
      checkIn: day(checkIn),
      checkOut: day(checkOut),
      datePrecision: "DAY",
      nights: Math.round((day(checkOut).getTime() - day(checkIn).getTime()) / 86_400_000),
      status: "completed",
    },
  });
  return s.id;
}

async function roadtrip(
  userId: string,
  spec: {
    name: string;
    vehicle: string;
    vehicleName: string;
    stations: StationSpec[];
    /** Station indexes whose leg to the NEXT station is a ferry. */
    ferryFrom?: number[];
  }
): Promise<{ routeId: string; stationIds: string[] }> {
  const route = await prisma.tripRoute.create({
    data: {
      userId,
      tripId: null,
      kind: "roadtrip",
      name: `${DEMO_PREFIX}${spec.name}`,
      mode: "road",
      vehicle: spec.vehicle,
      vehicleName: spec.vehicleName,
      orderIdx: 0,
    },
  });
  const stops: StopCoords[] = [];
  for (const [index, s] of spec.stations.entries()) {
    stops.push(
      await prisma.tripStop.create({
        data: {
          tripId: null,
          domain: "roadtrip",
          title: s.title,
          lat: s.lat,
          lon: s.lon,
          startDate: day(s.start),
          endDate: s.end ? day(s.end) : null,
          routeId: route.id,
          routeOrderIdx: index,
          overnight: s.night !== "pass",
          lodgingStayId: typeof s.night === "object" ? s.night.stayId : null,
        },
        select: { id: true, lat: true, lon: true },
      })
    );
  }
  const created = await prisma.$transaction((tx) => recomputeLegs(tx, route.id, "road", stops), {
    timeout: 30_000,
  });
  // The ferry BEFORE routing: a road router asked for Hirtshals -> Kristiansand
  // drives round the Skagerrak, and a ferry leg is not routable, so it stays
  // the crossing it is.
  for (const i of spec.ferryFrom ?? []) {
    await prisma.tripRouteLeg.updateMany({
      where: { routeId: route.id, fromStopId: stops[i].id, toStopId: stops[i + 1].id },
      data: { mode: "ferry" },
    });
  }
  await autoRouteNewLegs(userId, route.id, created);
  return { routeId: route.id, stationIds: stops.map((s) => s.id) };
}

async function tour(
  userId: string,
  spec: {
    name: string;
    mode: string;
    activity: string;
    tripId?: string | null;
    anchorStopId?: string | null;
    points: Array<{ title: string; lat: number; lon: number }>;
  }
): Promise<string> {
  const route = await prisma.tripRoute.create({
    data: {
      userId,
      tripId: spec.tripId ?? null,
      kind: "tour",
      name: `${DEMO_PREFIX}${spec.name}`,
      mode: spec.mode,
      activity: spec.activity,
      anchorStopId: spec.anchorStopId ?? null,
      orderIdx: 0,
    },
  });
  const stops: StopCoords[] = [];
  for (const [index, p] of spec.points.entries()) {
    stops.push(
      await prisma.tripStop.create({
        data: {
          tripId: spec.tripId ?? null,
          title: p.title,
          lat: p.lat,
          lon: p.lon,
          routeId: route.id,
          routeOrderIdx: index,
        },
        select: { id: true, lat: true, lon: true },
      })
    );
  }
  const created = await prisma.$transaction((tx) => recomputeLegs(tx, route.id, spec.mode, stops), {
    timeout: 30_000,
  });
  await autoRouteNewLegs(userId, route.id, created);
  return route.id;
}

/** A GPX recording between two points: `n` samples, climbing to `peakM` halfway and back. */
function gpx(
  name: string,
  from: [number, number],
  to: [number, number],
  opts: {
    startIso: string;
    minutes: number;
    lowM: number;
    peakM: number;
    n: number;
    outAndBack: boolean;
  }
): string {
  const start = Date.parse(opts.startIso);
  const pts: string[] = [];
  for (let i = 0; i <= opts.n; i++) {
    const f = i / opts.n;
    const leg = opts.outAndBack ? (f <= 0.5 ? f * 2 : (1 - f) * 2) : f;
    const wobble = Math.sin(f * Math.PI * 9) * 0.0012;
    const lat = from[0] + (to[0] - from[0]) * leg + wobble;
    const lon = from[1] + (to[1] - from[1]) * leg + wobble * 0.6;
    const ele = opts.lowM + (opts.peakM - opts.lowM) * Math.sin(Math.min(leg, 1) * (Math.PI / 2));
    const t = new Date(start + f * opts.minutes * 60_000).toISOString();
    pts.push(
      `<trkpt lat="${lat.toFixed(5)}" lon="${lon.toFixed(5)}"><ele>${ele.toFixed(1)}</ele><time>${t}</time></trkpt>`
    );
  }
  return `<?xml version="1.0"?><gpx version="1.1" creator="TravStats demo"><trk><name>${name}</name><trkseg>${pts.join("")}</trkseg></trk></gpx>`;
}

async function recording(routeId: string, xml: string, fileName: string): Promise<void> {
  const file = await parseTrackFile(Buffer.from(xml), fileName);
  if (!file) throw new Error(`demo recording ${fileName} could not be read`);
  const ingested = ingestTrack(file.track);
  if (!ingested) throw new Error(`demo recording ${fileName} has no timestamps`);
  await prisma.tripRouteTrack.create({
    data: {
      routeId,
      source: file.format,
      name: file.track.name,
      ...ingestedTrackColumns(ingested),
      externalRef: null,
      truncated: false,
    },
  });
}

/** Seed the roadtrip and tour demo into one account. Returns what was made. */
export async function seedRoadtripDemo(userId: string): Promise<Record<string, number>> {
  await removePrevious(userId);

  // The roadtrip domain has to be on for the account to see any of it.
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const domains = settings?.enabledDomains ?? ["flight"];
  if (!domains.includes("roadtrip")) {
    await prisma.userSettings.upsert({
      where: { userId },
      update: { enabledDomains: [...domains, "roadtrip"] },
      create: { userId, data: {}, enabledDomains: [...domains, "roadtrip"] },
    });
  }

  // 1. Norway in a motorhome: ferry night, two campsites, a free night by the fjord.
  const mosvangen = await stay(
    userId,
    "Mosvangen Camping",
    "campsite",
    { lat: 58.9524, lon: 5.7174, city: "Stavanger", country: "Norwegen", iso: "NO" },
    "2025-07-15",
    "2025-07-17"
  );
  const bergenCamp = await stay(
    userId,
    "Bergenshallen Camping",
    "campsite",
    { lat: 60.3706, lon: 5.3624, city: "Bergen", country: "Norwegen", iso: "NO" },
    "2025-07-17",
    "2025-07-19"
  );
  const norway = await roadtrip(userId, {
    name: "Norwegen mit dem Wohnmobil",
    vehicle: "motorhome",
    vehicleName: "Der Dicke",
    ferryFrom: [1],
    stations: [
      { title: "Hamburg", lat: 53.5511, lon: 9.9937, start: "2025-07-13", night: "pass" },
      {
        title: "Hirtshals",
        lat: 57.579,
        lon: 9.976,
        start: "2025-07-14",
        end: "2025-07-15",
        night: "free",
      },
      { title: "Kristiansand", lat: 58.1467, lon: 7.9956, start: "2025-07-15", night: "pass" },
      {
        title: "Stavanger",
        lat: 58.9524,
        lon: 5.7174,
        start: "2025-07-15",
        end: "2025-07-17",
        night: { stayId: mosvangen },
      },
      {
        title: "Bergen",
        lat: 60.3706,
        lon: 5.3624,
        start: "2025-07-17",
        end: "2025-07-19",
        night: { stayId: bergenCamp },
      },
      {
        title: "Geiranger",
        lat: 62.1008,
        lon: 7.2059,
        start: "2025-07-19",
        end: "2025-07-20",
        night: "free",
      },
      { title: "Ålesund", lat: 62.4722, lon: 6.1495, start: "2025-07-20", night: "pass" },
    ],
  });

  const preikestolen = await tour(userId, {
    name: "Preikestolen",
    mode: "foot",
    activity: "hike",
    anchorStopId: norway.stationIds[3],
    points: [
      { title: "Preikestolen Fjellstue", lat: 58.991, lon: 6.1374 },
      { title: "Preikestolen", lat: 58.9878, lon: 6.1904 },
    ],
  });
  await recording(
    preikestolen,
    gpx("Preikestolen", [58.991, 6.1374], [58.9878, 6.1904], {
      startIso: "2025-07-16T08:30:00Z",
      minutes: 240,
      lowM: 270,
      peakM: 604,
      n: 480,
      outAndBack: true,
    }),
    "preikestolen.gpx"
  );

  // 2. The Alps in a campervan: free nights only, a planned gorge walk.
  const alps = await roadtrip(userId, {
    name: "Alpen mit dem Campervan",
    vehicle: "campervan",
    vehicleName: "Bulli",
    stations: [
      { title: "München", lat: 48.1374, lon: 11.5755, start: "2025-08-02", night: "pass" },
      {
        title: "Garmisch-Partenkirchen",
        lat: 47.4815,
        lon: 11.1176,
        start: "2025-08-02",
        end: "2025-08-03",
        night: "free",
      },
      { title: "Innsbruck", lat: 47.2692, lon: 11.4041, start: "2025-08-03", night: "pass" },
      {
        title: "Bozen",
        lat: 46.4983,
        lon: 11.3548,
        start: "2025-08-03",
        end: "2025-08-05",
        night: "free",
      },
      {
        title: "Riva del Garda",
        lat: 45.8854,
        lon: 10.8418,
        start: "2025-08-05",
        end: "2025-08-07",
        night: "free",
      },
    ],
  });
  await tour(userId, {
    name: "Partnachklamm",
    mode: "foot",
    activity: "walk",
    anchorStopId: alps.stationIds[1],
    points: [
      { title: "Olympia-Skistadion", lat: 47.4815, lon: 11.1176 },
      { title: "Partnachklamm", lat: 47.4646, lon: 11.1221 },
      { title: "Graseck", lat: 47.4617, lon: 11.1146 },
    ],
  });

  // 3. A standalone bike tour with a recording, belonging to no trip.
  const isar = await tour(userId, {
    name: "Isarradweg bis Wolfratshausen",
    mode: "bike",
    activity: "bike",
    points: [
      { title: "München, Flaucher", lat: 48.1106, lon: 11.5586 },
      { title: "Wolfratshausen", lat: 47.9133, lon: 11.4225 },
    ],
  });
  await recording(
    isar,
    gpx("Isarradweg", [48.1106, 11.5586], [47.9133, 11.4225], {
      startIso: "2025-06-01T09:00:00Z",
      minutes: 110,
      lowM: 520,
      peakM: 590,
      n: 400,
      outAndBack: false,
    }),
    "isarradweg.gpx"
  );

  // 4. A trip with stops and journal entries — the days open data can fill
  //    with their weather, and a trip-bound walking tour for the trip's tab.
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: `${DEMO_PREFIX}Sommer in Norwegen`,
      startDate: day("2025-07-15"),
      endDate: day("2025-07-19"),
    },
  });
  for (const s of [
    { title: "Stavanger", lat: 58.97, lon: 5.7331, start: "2025-07-15", end: "2025-07-17" },
    { title: "Bergen", lat: 60.3913, lon: 5.3221, start: "2025-07-17", end: "2025-07-19" },
  ]) {
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        title: s.title,
        lat: s.lat,
        lon: s.lon,
        startDate: day(s.start),
        endDate: day(s.end),
      },
    });
  }
  await prisma.tripJournalEntry.createMany({
    data: [
      {
        tripId: trip.id,
        date: day("2025-07-16"),
        title: "Preikestolen",
        body: "Früh los, oben fast allein. Der Blick auf den Lysefjord!",
        mood: "begeistert",
      },
      {
        tripId: trip.id,
        date: day("2025-07-18"),
        title: "Bergen im Regen",
        body: "Bryggen, Fischmarkt, Fløibanen – und natürlich Regen.",
        mood: "entspannt",
      },
    ],
  });
  await tour(userId, {
    name: "Stadtrundgang Bergen",
    mode: "foot",
    activity: "walk",
    tripId: trip.id,
    points: [
      { title: "Bryggen", lat: 60.3975, lon: 5.3242 },
      { title: "Fischmarkt", lat: 60.3949, lon: 5.3249 },
      { title: "Fløibanen", lat: 60.3963, lon: 5.3284 },
    ],
  });

  return {
    roadtrips: 2,
    dayTours: 4,
    recordings: 2,
    lodgings: 2,
    trips: 1,
    journalEntries: 2,
  };
}
