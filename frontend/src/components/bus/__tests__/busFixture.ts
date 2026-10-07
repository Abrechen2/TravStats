import type { BusJourney } from "../../../types/bus";
import type { BusStationDraft } from "../BusStationField";

/** A placed terminal as the form holds it (`BusStationDraft`): the address is text, empty when none. */
export const SEOUL = {
  name: "Seoul Express Bus Terminal",
  address: "",
  lat: 37.5048,
  lon: 127.0046,
  country: "KR",
} satisfies BusStationDraft;

/** One completed Seoul to Sokcho ride, with its stored times — the bus tests' shared starting point. */
export function rideFixture(): BusJourney {
  return {
    id: "r1",
    userId: "u1",
    operator: "Kobus",
    lineName: "Premium",
    rideKind: "intercity",
    depStationName: SEOUL.name,
    depAddress: null,
    depLat: SEOUL.lat,
    depLon: SEOUL.lon,
    depCountry: "KR",
    depTimezone: "Asia/Seoul",
    arrStationName: "Sokcho Express Bus Terminal",
    arrAddress: null,
    arrLat: 38.1911,
    arrLon: 128.5918,
    arrCountry: "KR",
    arrTimezone: "Asia/Seoul",
    departureTime: "2026-09-20T00:00:00.000Z",
    arrivalTime: "2026-09-20T02:20:00.000Z",
    distanceKm: 159,
    distanceSource: "great_circle",
    geometry: null,
    geometrySource: "straight",
    actualDepartureTime: null,
    actualArrivalTime: null,
    fareClass: null,
    seat: null,
    bookingReference: null,
    price: 23000,
    currency: "KRW",
    status: "completed",
    delayMinutes: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    createdAt: "2026-09-20T03:00:00.000Z",
    updatedAt: "2026-09-20T03:00:00.000Z",
    times: {
      departure: {
        utc: "2026-09-20T00:00:00.000Z",
        zone: "Asia/Seoul",
        offset: "+09:00",
        local: "2026-09-20T09:00:00",
        precision: "minute",
      },
      arrival: {
        utc: "2026-09-20T02:20:00.000Z",
        zone: "Asia/Seoul",
        offset: "+09:00",
        local: "2026-09-20T11:20:00",
        precision: "minute",
      },
      actualDeparture: null,
      actualArrival: null,
    },
  };
}
