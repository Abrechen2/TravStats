import { randomUUID } from "crypto";
import { emptyState, stateSchema } from "../schema";
import { parseState, upgradeV1 } from "../upgrade";

const uid = () => randomUUID();

function v1Plan() {
  const bookingId = uid();
  const itemId = uid();
  return {
    version: 1,
    creationHash: null,
    destination: "Norway",
    startDay: "2027-06-01",
    endDay: "2027-06-10",
    timezone: "Europe/Oslo",
    latitude: 60.1,
    longitude: 10.2,
    travelers: 2,
    pace: "balanced",
    budget: 4000,
    currency: "EUR",
    freeDays: ["2027-06-05"],
    openNights: ["2027-06-03"],
    status: "planning",
    handoverRevision: null,
    ai: { enabled: false, policy: "local_only" },
    packingProfile: { washing: "unknown", luggage: "cabin" },
    items: [
      {
        id: itemId,
        title: "Fjord walk",
        kind: "activity",
        day: "2027-06-02",
        time: "10:00",
        duration: 120,
        timezone: null,
        place: "Flam",
        note: "",
        booked: false,
        bookingId: null,
        execution: "unconfirmed",
        source: null,
      },
    ],
    ideas: [
      {
        id: uid(),
        title: "Glacier",
        category: "nature",
        priority: "must",
        note: "",
        itemId: null,
      },
    ],
    bookings: [
      {
        id: bookingId,
        actualBookingId: null,
        priceGroupId: null,
        kind: "hotel",
        title: "Hotel Fjord",
        reference: "ABC",
        provider: "Booking",
        day: "2027-06-02",
        endDay: "2027-06-04",
        time: null,
        timezone: null,
        arrivalDay: null,
        arrivalTime: null,
        arrivalTimezone: null,
        originPlace: "",
        overnight: false,
        amount: 300,
        paid: 100,
        currency: "EUR",
        place: "Flam",
        city: "",
        country: "",
        address: "",
        documentIds: [],
        source: "manual",
        details: { room: "double" },
      },
    ],
    transfers: [
      {
        id: uid(),
        fromId: itemId,
        toId: bookingId,
        status: "open",
        mode: "car",
        note: "",
        duration: 30,
        buffer: 10,
        fingerprint: null,
      },
    ],
    packing: [
      {
        id: uid(),
        label: "Rain jacket",
        category: "clothes",
        quantity: 1,
        packed: false,
        scope: "personal",
        note: "",
        manual: true,
      },
    ],
    tasks: [{ id: uid(), title: "Book ferry", due: "2027-05-01", done: false }],
    costs: [
      {
        id: uid(),
        title: "Fuel",
        amount: 200,
        currency: "EUR",
        paid: 0,
        kind: "estimate",
      },
    ],
    decisions: [
      {
        id: "d1",
        fingerprint: "fp",
        choice: "conscious",
        decidedAt: "2027-01-01T00:00:00.000Z",
      },
    ],
    forecast: {
      latitude: 60.1,
      longitude: 10.2,
      timezone: "Europe/Oslo",
      source: "https://api.open-meteo.com/v1/forecast",
      fetchedAt: "2027-05-30T00:00:00.000Z",
      days: [{ day: "2027-06-01", min: 8, max: 17, rainProbability: 20, wind: 12 }],
    },
  };
}

function routeState() {
  const a = uid();
  const b = uid();
  const place = { name: "Oslo", lat: 59.9, lon: 10.7, country: "NO", zone: null, ref: null };
  const station = (id: string) => ({
    id,
    title: "Stop",
    place,
    nights: 1,
    pinnedDay: null,
    night: { kind: "spontaneous" as const },
    note: "",
  });
  const stage = {
    id: uid(),
    fromStationId: a,
    toStationId: b,
    mode: "drive" as const,
    departDay: null,
    departTime: null,
    durationMinutes: null,
    distanceKm: null,
    metricsSource: null,
    fallbackReason: null,
    bookingId: null,
    overnight: false,
    note: "",
  };
  return {
    ...emptyState(),
    shape: "route" as const,
    stations: [station(a), station(b)],
    stages: [stage],
  };
}

describe("plan state v2 upgrade", () => {
  it("upgrades a v1 plan with every collection filled losslessly", () => {
    const v1 = v1Plan();
    const got = parseState(v1);
    expect(got).toEqual({
      ...v1,
      version: 2,
      shape: "stay",
      stations: [],
      stages: [],
      variants: [],
      activeVariantName: "A",
      vehicle: null,
      roadtripId: null,
      stationLinks: [],
      stationWeather: [],
      items: v1.items.map((i) => ({ ...i, stationId: null })),
      bookings: v1.bookings.map((b) => ({
        ...b,
        placeholder: false,
        estimate: null,
        stageId: null,
      })),
    });
  });

  it("leaves a v2 plan untouched", () => {
    const v2 = emptyState();
    expect(upgradeV1(v2)).toBe(v2);
    expect(parseState(v2)).toEqual(v2);
  });

  it("rejects a route station whose stage points at a missing station", () => {
    const state = routeState();
    state.stages[0] = { ...state.stages[0], toStationId: randomUUID() };
    expect(stateSchema.safeParse(state).success).toBe(false);
  });

  it("accepts a consistent route", () => {
    expect(stateSchema.safeParse(routeState()).success).toBe(true);
  });

  it("rejects more than 60 stations", () => {
    const state = routeState();
    const stations = Array.from({ length: 61 }, () => ({ ...state.stations[0], id: randomUUID() }));
    expect(stateSchema.safeParse({ ...state, stations, stages: [] }).success).toBe(false);
  });
});
