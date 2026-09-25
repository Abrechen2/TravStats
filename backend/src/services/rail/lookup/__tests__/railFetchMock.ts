/**
 * Test support for the rail lookup: a stand-in for global `fetch` and
 * Transitous/db-rest answers shaped like the real ones (recorded against
 * api.transitous.org on 2026-09-25, trimmed). Every call is recorded, and a
 * URL no route claims FAILS the test instead of reaching the network.
 */

type Answer = unknown | ((url: string) => unknown);

export interface FetchMock {
  calls: string[];
  /** The User-Agent each call sent, in call order. */
  userAgents: Array<string | null>;
  restore: () => void;
}

export function mockFetch(routes: ReadonlyArray<readonly [RegExp, Answer, number?]>): FetchMock {
  const calls: string[] = [];
  const userAgents: Array<string | null> = [];
  const spy = jest
    .spyOn(global, "fetch")
    .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      userAgents.push(new Headers(init?.headers).get("User-Agent"));
      const route = routes.find(([pattern]) => pattern.test(url));
      if (!route) throw new Error(`Unexpected fetch in test: ${url}`);
      const [, answer, status = 200] = route;
      const body = typeof answer === "function" ? (answer as (u: string) => unknown)(url) : answer;
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
  return { calls, userAgents, restore: () => spy.mockRestore() };
}

/** Google's polyline encoding, the inverse of `decodePolyline`. */
export function encodePolyline(points: ReadonlyArray<[number, number]>, precision = 6): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLon = 0;
  const encode = (value: number): string => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * factor);
    const lo = Math.round(lon * factor);
    out += encode(la - prevLat) + encode(lo - prevLon);
    prevLat = la;
    prevLon = lo;
  }
  return out;
}

export const FRANKFURT = { name: "Frankfurt (Main) Hauptbahnhof", lat: 50.107149, lon: 8.663785 };
export const FULDA = { name: "Fulda Bahnhof", lat: 50.554913, lon: 9.684386 };
export const BERLIN = { name: "S+U Gesundbrunnen Bhf (Berlin)", lat: 52.548611, lon: 13.388378 };

/** Points every ~2 km along the straight pieces between the stations — a traced line. */
export function tracedLine(stops: ReadonlyArray<{ lat: number; lon: number }>): [number, number][] {
  const line: [number, number][] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    const steps = 150;
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      const f = k / steps;
      line.push([a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f]);
    }
  }
  return line;
}

export const TRIP_ID = "20260926_06:15_de-DELFI_3419369335";

/** One stoptimes page with the asked-for ICE 696 among others. */
export function stopTimesPage(day: string): unknown {
  const at = (hhmm: string): string => `${day}T${hhmm}:00Z`;
  return {
    stopTimes: [
      {
        place: { ...FRANKFURT, scheduledDeparture: at("04:10") },
        tripId: "other-1",
        tripShortName: "ICE 1696",
        routeShortName: "11",
        displayName: "ICE 1696",
        mode: "HIGHSPEED_RAIL",
      },
      {
        place: { ...FRANKFURT, scheduledDeparture: at("04:15") },
        tripId: TRIP_ID,
        tripShortName: "ICE 696",
        routeShortName: "11",
        displayName: "ICE 696",
        agencyName: "DB Fernverkehr AG",
        mode: "HIGHSPEED_RAIL",
      },
    ],
    place: { name: "center", lat: FRANKFURT.lat, lon: FRANKFURT.lon },
    previousPageCursor: "",
    nextPageCursor: "",
  };
}

/** /api/v6/trip for ICE 696; `line` decides whether it is traced or chords. */
export function tripAnswer(line: ReadonlyArray<[number, number]>): unknown {
  return {
    legs: [
      {
        mode: "HIGHSPEED_RAIL",
        from: { ...FRANKFURT, scheduledDeparture: "2026-09-26T04:15:00Z" },
        to: { ...BERLIN, scheduledArrival: "2026-09-26T08:43:00Z" },
        intermediateStops: [
          {
            ...FULDA,
            scheduledArrival: "2026-09-26T05:10:00Z",
            scheduledDeparture: "2026-09-26T05:12:00Z",
          },
        ],
        agencyName: "DB Fernverkehr AG",
        tripShortName: "ICE 696",
        displayName: "ICE 696",
        tripId: TRIP_ID,
        legGeometry: { points: encodePolyline(line), precision: 6, length: line.length },
      },
    ],
  };
}
