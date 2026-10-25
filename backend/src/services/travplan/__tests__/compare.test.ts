import { comparePlanActual } from "../actual/compare";
import { distanceM } from "../../travtrack/classify";
import type { PlanSnapshot } from "../actual/planSnapshot";
import type { ActualPosition, ActualRoute, ActualStay } from "../actual/actualRoute";
import type { PlanStage, PlanStation } from "../types";

/**
 * Plan versus actual, pure (TravTrack plan L5). A three-station route:
 * Munich (1–2 Oct) → Salzburg (3 Oct, pass-through) → Vienna (4–6 Oct).
 */

const MUNICH = { lat: 48.137, lon: 11.575 };
const SALZBURG = { lat: 47.809, lon: 13.055 };
const VIENNA = { lat: 48.208, lon: 16.373 };
const ZURICH = { lat: 47.376, lon: 8.541 };

const station = (id: string, title: string, at: { lat: number; lon: number }): PlanStation => ({
  id,
  title,
  place: { name: title, ...at, country: null, zone: null, ref: null },
  nights: 0,
  pinnedDay: null,
  night: { kind: "spontaneous" },
  note: "",
});
const stage = (id: string, from: string, to: string, km: number | null): PlanStage => ({
  id,
  fromStationId: from,
  toStationId: to,
  mode: "drive",
  departDay: null,
  departTime: null,
  durationMinutes: null,
  distanceKm: km,
  metricsSource: km === null ? null : "routed",
  fallbackReason: null,
  bookingId: null,
  overnight: false,
  note: "",
});

function plan(): PlanSnapshot {
  return {
    revision: 7,
    stations: [
      station("m", "München", MUNICH),
      station("s", "Salzburg", SALZBURG),
      station("v", "Wien", VIENNA),
    ],
    stages: [stage("ms", "m", "s", 145), stage("sv", "s", "v", 295)],
    items: [],
    startDay: "2026-10-01",
    endDay: "2026-10-06",
    timezone: "Europe/Berlin",
    schedule: {
      stations: [
        { stationId: "m", arriveDay: "2026-10-01", departDay: "2026-10-02" },
        { stationId: "s", arriveDay: "2026-10-03", departDay: "2026-10-03" },
        { stationId: "v", arriveDay: "2026-10-04", departDay: "2026-10-06" },
      ],
      stages: [],
      lastDay: "2026-10-06",
      conflicts: [],
      unresolved: [],
    },
  };
}

/** Positions at mid-day UTC of `day` (mid-day in Berlin and Vienna too), a minute apart. */
let tick = 0;
const at = (
  day: string,
  p: { lat: number; lon: number },
  deviceId: string | null = "phone",
  stretch = 0
): ActualPosition => {
  tick += 1;
  return { atMs: Date.parse(`${day}T10:00:00Z`) + tick * 60_000, ...p, deviceId, stretch };
};
const instant = (iso: string, p: { lat: number; lon: number }): ActualPosition => ({
  atMs: Date.parse(iso),
  ...p,
  deviceId: "phone",
  stretch: 0,
});
const ALL_DAYS = [
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
];

function actual(
  positions: ActualPosition[],
  opts: {
    stays?: ActualStay[];
    recorded?: string[];
    circles?: ActualRoute["circles"];
    coverage?: ActualRoute["coverage"];
    zone?: string;
  } = {}
): ActualRoute {
  const recordedAtMs = (
    opts.recorded
      ? opts.recorded.map((d) => Date.parse(`${d}T10:00:00Z`))
      : positions.map((p) => p.atMs)
  ).sort((a, b) => a - b);
  return {
    segments: [],
    days: ALL_DAYS.map((day) => ({ day, state: "noData" })),
    stays: opts.stays ?? [],
    coverage: opts.coverage ?? "complete",
    origin: "travtrack",
    zone: opts.zone ?? "Europe/Berlin",
    recordedAtMs,
    positions,
    circles: opts.circles ?? [],
  };
}

const statusOf = (result: ReturnType<typeof comparePlanActual>, id: string) =>
  result.stations.find((s) => s.stationId === id)!;

describe("comparePlanActual", () => {
  it("a station passed on its planned day is visited", () => {
    const result = comparePlanActual(plan(), actual([at("2026-10-03", SALZBURG)]));
    expect(statusOf(result, "s")).toMatchObject({
      status: "visited",
      deltaDays: 0,
      actualFrom: "2026-10-03",
      plannedFrom: "2026-10-03",
    });
  });

  it("a day late is still visited, within the one-day tolerance, and says one day late", () => {
    const result = comparePlanActual(plan(), actual([at("2026-10-04", SALZBURG)]));
    expect(statusOf(result, "s")).toMatchObject({ status: "visited", deltaDays: 1 });
  });

  it("beyond the tolerance it is shifted, by the days after the planned departure", () => {
    const result = comparePlanActual(
      plan(),
      actual([at("2026-10-05", SALZBURG), at("2026-10-06", SALZBURG)])
    );
    expect(statusOf(result, "s")).toMatchObject({
      status: "shifted",
      deltaDays: 2,
      actualFrom: "2026-10-05",
      actualUntil: "2026-10-06",
    });
  });

  it("recorded days around a station never near it → skipped", () => {
    const result = comparePlanActual(
      plan(),
      actual([at("2026-10-02", MUNICH), at("2026-10-03", ZURICH), at("2026-10-04", VIENNA)])
    );
    expect(statusOf(result, "s")).toMatchObject({ status: "skipped", actualFrom: null });
  });

  it("no data on its days → unknown, never skipped", () => {
    const result = comparePlanActual(
      plan(),
      actual([at("2026-10-01", MUNICH), at("2026-10-05", VIENNA)])
    );
    expect(statusOf(result, "s")).toMatchObject({ status: "unknown", deltaDays: null });
  });

  it("a short read never proves a skip", () => {
    const result = comparePlanActual(
      plan(),
      actual([at("2026-10-03", ZURICH)], { coverage: "truncated" })
    );
    expect(statusOf(result, "s").status).toBe("unknown");
  });

  it("a station inside a zone → unknown, and says nothing more", () => {
    const result = comparePlanActual(
      plan(),
      actual([at("2026-10-03", SALZBURG)], { circles: [{ ...SALZBURG, radiusM: 500 }] })
    );
    expect(statusOf(result, "s")).toEqual({
      stationId: "s",
      title: "Salzburg",
      plannedFrom: "2026-10-03",
      plannedUntil: "2026-10-03",
      status: "unknown",
      deltaDays: null,
      actualFrom: null,
      actualUntil: null,
    });
  });

  it("an accepted stay near a station is a visit", () => {
    const stay: ActualStay = {
      id: "st1",
      kind: "lodging",
      atMs: null,
      day: "2026-10-05",
      ...VIENNA,
      label: "Hotel Sacher",
    };
    const result = comparePlanActual(plan(), actual([], { stays: [stay], recorded: [] }));
    expect(statusOf(result, "v")).toMatchObject({ status: "visited", deltaDays: 1 });
  });

  it("a stay inside a privacy circle never makes a station outside it visited by itself", () => {
    // The zone is 3 km across, 10 km from Vienna's station: the hotel in it is near the station.
    const zone = { lat: VIENNA.lat + 0.09, lon: VIENNA.lon, radiusM: 3000 };
    const stay: ActualStay = {
      id: "h",
      kind: "lodging",
      atMs: null,
      day: "2026-10-05",
      lat: zone.lat,
      lon: zone.lon,
      label: "Home",
    };
    const alone = comparePlanActual(
      plan(),
      actual([], { stays: [stay], recorded: [], circles: [zone] })
    );
    expect(statusOf(alone, "v").status).toBe("unknown");
    // Track evidence for the station still counts.
    const withTrack = comparePlanActual(
      plan(),
      actual([at("2026-10-05", VIENNA)], { stays: [stay], circles: [zone] })
    );
    expect(statusOf(withTrack, "v")).toMatchObject({ status: "visited", deltaDays: 1 });
    // Near a station, so not unplanned either (a far one is listed: the owner's own record).
    expect(alone.unplanned).toEqual([]);
  });

  it("stage km only between two visited stations", () => {
    const track = [
      at("2026-10-02", MUNICH),
      at("2026-10-02", { lat: 47.95, lon: 12.3 }),
      at("2026-10-03", SALZBURG),
    ];
    const result = comparePlanActual(plan(), actual(track));
    const ms = result.stages.find((s) => s.stageId === "ms")!;
    expect(ms.plannedKm).toBe(145);
    expect(ms.actualKm).toBeGreaterThan(100);
    expect(ms.actualKm).toBeLessThan(140);
    // Vienna was never reached: no figure, not 0.
    expect(result.stages.find((s) => s.stageId === "sv")).toMatchObject({
      plannedKm: 295,
      actualKm: null,
    });
  });

  it("a stage is measured from the closest approach to each place, not from the 15 km circle", () => {
    // A straight drive in 20 steps from Munich's centre to Salzburg's.
    const track = Array.from({ length: 21 }, (_, i) =>
      at("2026-10-03", {
        lat: MUNICH.lat + ((SALZBURG.lat - MUNICH.lat) * i) / 20,
        lon: MUNICH.lon + ((SALZBURG.lon - MUNICH.lon) * i) / 20,
      })
    );
    const result = comparePlanActual(plan(), actual(track));
    const chordKm = distanceM(MUNICH, SALZBURG) / 1000;
    expect(result.stages.find((s) => s.stageId === "ms")!.actualKm).toBeCloseTo(chordKm, 0);
  });

  it("never sums across a break: a stage whose path crosses one has no length", () => {
    const track = [
      at("2026-10-02", MUNICH, "phone", 0),
      at("2026-10-02", { lat: 47.95, lon: 12.3 }, "phone", 0),
      // A deleted range, a privacy cut, a flight or a recording gap lies here.
      at("2026-10-03", { lat: 47.9, lon: 12.7 }, "phone", 1),
      at("2026-10-03", SALZBURG, "phone", 1),
    ];
    const result = comparePlanActual(plan(), actual(track));
    expect(statusOf(result, "m").status).toBe("visited");
    expect(statusOf(result, "s").status).toBe("visited");
    expect(result.stages.find((s) => s.stageId === "ms")!.actualKm).toBeNull();
  });

  it("a stay-only visit gives the stage no length", () => {
    const stays: ActualStay[] = [
      { id: "a", kind: "lodging", atMs: null, day: "2026-10-01", ...MUNICH, label: "A" },
      { id: "b", kind: "place", atMs: null, day: "2026-10-03", ...SALZBURG, label: "B" },
    ];
    const result = comparePlanActual(plan(), actual([], { stays }));
    expect(result.stages.find((s) => s.stageId === "ms")!.actualKm).toBeNull();
  });

  it("a far accepted stay is unplanned, listed once", () => {
    const stays: ActualStay[] = [
      { id: "z", kind: "lodging", atMs: null, day: "2026-10-02", ...ZURICH, label: "Hotel Zürich" },
      { id: "z", kind: "lodging", atMs: null, day: "2026-10-03", ...ZURICH, label: "Hotel Zürich" },
      { id: "w", kind: "place", atMs: null, day: "2026-10-05", ...VIENNA, label: "Stephansdom" },
    ];
    const result = comparePlanActual(plan(), actual([], { stays }));
    expect(result.unplanned).toEqual([
      { kind: "lodging", day: "2026-10-02", ...ZURICH, label: "Hotel Zürich" },
    ]);
  });

  describe("on each station's own calendar", () => {
    // 22:30 UTC on the 3rd is 00:30 on the 4th in Salzburg: one day late there,
    // whatever clock the trip is listed on.
    const lateNight = "2026-10-03T22:30:00Z";

    it("a fix just after the station's midnight counts on the station's day", () => {
      const result = comparePlanActual(
        plan(),
        actual([instant(lateNight, SALZBURG)], { zone: "UTC" })
      );
      expect(statusOf(result, "s")).toMatchObject({ deltaDays: 1, actualFrom: "2026-10-04" });
    });

    it("the same visit gets the same day and delta from a fix as from a place visit", () => {
      const fromTrack = statusOf(
        comparePlanActual(plan(), actual([instant(lateNight, SALZBURG)], { zone: "UTC" })),
        "s"
      );
      const visit: ActualStay = {
        id: "p",
        kind: "place",
        atMs: Date.parse(lateNight),
        day: "2026-10-04",
        ...SALZBURG,
        label: "Festung",
      };
      const fromVisit = statusOf(
        comparePlanActual(plan(), actual([], { stays: [visit], recorded: [], zone: "UTC" })),
        "s"
      );
      expect(fromVisit).toEqual(fromTrack);
    });

    it("across the date line a station is read on its own side of it", () => {
      const KIRITIMATI = { lat: 1.87, lon: -157.4 };
      const p = plan();
      const island = {
        ...p.stations[1],
        place: { ...p.stations[1].place, ...KIRITIMATI, zone: "Pacific/Kiritimati" },
      };
      const onIsland: PlanSnapshot = {
        ...p,
        stations: [p.stations[0], island, p.stations[2]],
        schedule: {
          ...p.schedule,
          stations: [
            p.schedule.stations[0],
            { stationId: "s", arriveDay: "2026-10-04", departDay: "2026-10-04" },
            p.schedule.stations[2],
          ],
        },
      };
      // 11:00 UTC on the 3rd: 01:00 on the 4th in Kiritimati (UTC+14), but still
      // midnight of the 3rd on a trip listed in Pago Pago (UTC−11).
      const fix = instant("2026-10-03T11:00:00Z", KIRITIMATI);
      const result = comparePlanActual(onIsland, actual([fix], { zone: "Pacific/Pago_Pago" }));
      expect(statusOf(result, "s")).toMatchObject({
        status: "visited",
        deltaDays: 0,
        actualFrom: "2026-10-04",
      });
    });

    it("a skip is judged on the station's days: a recorded fix late on its eve is not its day", () => {
      // Only fix: 21:30 UTC on the 2nd = 23:30 on the 2nd in Salzburg, far away.
      const result = comparePlanActual(
        plan(),
        actual([instant("2026-10-02T21:30:00Z", { lat: 52.5, lon: 13.4 })], { zone: "Asia/Tokyo" })
      );
      // On Tokyo's clock that fix is on the 3rd, Salzburg's planned day — but not in Salzburg.
      expect(statusOf(result, "s").status).toBe("unknown");
    });
  });

  it("no track: every station unknown, no stage length, nothing unplanned", () => {
    const result = comparePlanActual(plan(), null);
    expect(result.stations.map((s) => s.status)).toEqual(["unknown", "unknown", "unknown"]);
    expect(result.stages.map((s) => s.actualKm)).toEqual([null, null]);
    expect(result.unplanned).toEqual([]);
  });
});
