import type { PlanBooking, PlanPlace, PlanState, PlanView } from "../../../../lib/api/travplan";
import { planFixture } from "../../__tests__/planFixture";

export const place = (name: string, lat: number, lon: number): PlanPlace => ({
  name,
  lat,
  lon,
  country: "DE",
  zone: "Europe/Berlin",
  ref: null,
});

const booking = (id: string, over: Partial<PlanBooking>): PlanBooking => ({
  id,
  kind: "ferry",
  title: "Kiel - Gothenburg",
  reference: "STENA-9",
  provider: "Stena Line",
  day: "2026-05-03",
  endDay: null,
  time: "18:00",
  timezone: "Europe/Berlin",
  amount: 180,
  paid: 0,
  currency: "EUR",
  place: "Gothenburg",
  documentIds: [],
  source: "manual",
  details: {},
  placeholder: false,
  estimate: null,
  stageId: null,
  ...over,
});

/** Kiel (2 nights) -> Gothenburg (1) -> Oslo; two drive stages, one booked and one placeholder booking. */
export function routeState({ measured = true } = {}): PlanState {
  const base = planFixture().state;
  return {
    ...base,
    shape: "route",
    destination: "Scandinavia",
    startDay: "2026-05-01",
    endDay: "2026-05-10",
    bookings: [
      booking("bk-booked", {}),
      booking("bk-hold", {
        placeholder: true,
        reference: null,
        amount: null,
        estimate: { amount: 150, currency: "EUR" },
      }),
    ],
    stations: [
      {
        id: "a",
        title: "Kiel",
        place: place("Kiel", 54.32, 10.14),
        nights: 2,
        pinnedDay: null,
        night: { kind: "booked", bookingId: "bk-booked" },
        note: "",
      },
      {
        id: "b",
        title: "Gothenburg",
        place: place("Gothenburg", 57.7, 11.97),
        nights: 1,
        pinnedDay: null,
        night: { kind: "spontaneous" },
        note: "",
      },
      {
        id: "c",
        title: "Oslo",
        place: place("Oslo", 59.91, 10.75),
        nights: 3,
        pinnedDay: null,
        night: { kind: "pitch" },
        note: "",
      },
    ],
    stages: [
      {
        id: "g1",
        fromStationId: "a",
        toStationId: "b",
        mode: "drive",
        departDay: null,
        departTime: null,
        durationMinutes: measured ? 90 : null,
        distanceKm: measured ? 60 : null,
        metricsSource: measured ? "routed" : null,
        fallbackReason: null,
        bookingId: null,
        overnight: false,
        note: "",
      },
      {
        id: "g2",
        fromStationId: "b",
        toStationId: "c",
        mode: "drive",
        departDay: null,
        departTime: null,
        durationMinutes: measured ? 60 : null,
        distanceKm: measured ? 40 : null,
        metricsSource: measured ? "straight" : null,
        fallbackReason: measured ? "provider_error" : null,
        bookingId: null,
        overnight: false,
        note: "",
      },
    ],
  };
}

export function routePlan(over: Partial<PlanView> = {}): PlanView {
  const fixture = planFixture("route-trip");
  return {
    ...fixture,
    name: "Ostsee und Norwegen",
    state: routeState(),
    schedule: {
      stations: [
        { stationId: "a", arriveDay: "2026-05-01", departDay: "2026-05-03" },
        { stationId: "b", arriveDay: "2026-05-03", departDay: "2026-05-04" },
        { stationId: "c", arriveDay: "2026-05-04", departDay: "2026-05-07" },
      ],
      stages: [],
      lastDay: "2026-05-07",
      conflicts: [],
      unresolved: [],
    },
    ...over,
  };
}
