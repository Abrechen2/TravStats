/**
 * A roadtrip station is country evidence — audit finding: the Stats overview
 * counted Norway for a campervan trip while the passport, reading only flights,
 * cruises, places, houses and tracks, did not know the country existed.
 *
 * The tier is structural like every other one: a night at the station (a
 * linked stay, or a free pitch) is `slept`, a station driven through is
 * `transited`.
 */
import { buildPassport } from "../passport";
import {
  attestStation,
  roadtripHasStarted,
  type PassportRoadtripStation,
  type RoadtripStationRow,
} from "../roadtripEvidence";

const NOW = new Date("2026-09-25T12:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const withStations = (stations: PassportRoadtripStation[]) =>
  buildPassport([], new Map(), [], NOW, [], [], [], undefined, [], stations);

const station = (overrides: Partial<RoadtripStationRow> = {}): RoadtripStationRow => ({
  lodgingStayId: null,
  overnight: false,
  startDate: d("2024-07-12"),
  endDate: null,
  lodgingStay: null,
  ...overrides,
});

describe("passport — roadtrip stations", () => {
  it("raises a country slept in at a free pitch as `slept`, with the station's days", () => {
    const p = withStations([
      { country: "NO", night: true, at: d("2024-07-14"), days: ["2024-07-14", "2024-07-15"] },
    ]);
    const no = p.countries.find((c) => c.code === "NO");
    expect(no).toMatchObject({
      tier: "slept",
      kinds: ["roadtrip"],
      evidence: "roadtrip",
      daysPresent: 2,
      firstYear: 2024,
      counted: true,
    });
    expect(p.summary.byEvidence.roadtrip).toBe(1);
  });

  it("raises a country only driven through as `transited`, which the default threshold counts", () => {
    const p = withStations([
      { country: "SE", night: false, at: d("2024-07-13"), days: ["2024-07-13"] },
    ]);
    expect(p.countries.find((c) => c.code === "SE")).toMatchObject({
      tier: "transited",
      counted: true,
    });
    expect(p.summary.countries).toBe(1);
  });

  it("contributes nothing for a station no country could be read for", () => {
    const p = withStations([{ country: null, night: true, at: null, days: [] }]);
    expect(p.countries).toHaveLength(0);
  });
});

describe("attestStation — what one station proves", () => {
  it("a free night attests its whole span", () => {
    expect(
      attestStation(station({ overnight: true, endDate: d("2024-07-14") }), NOW)
    ).toMatchObject({ night: true, days: ["2024-07-12", "2024-07-13", "2024-07-14"] });
  });

  it("a night station with no end attests only its start day", () => {
    expect(attestStation(station({ overnight: true }), NOW)?.days).toEqual(["2024-07-12"]);
  });

  it("a pass-through station attests one day and no night", () => {
    expect(attestStation(station(), NOW)).toMatchObject({ night: false, days: ["2024-07-12"] });
  });

  it("a station whose linked stay was cancelled attests nothing — a cancelled stay counts nowhere", () => {
    const cancelled = station({
      lodgingStayId: "s1",
      endDate: d("2024-07-14"),
      lodgingStay: {
        checkIn: d("2024-07-12"),
        checkOut: d("2024-07-14"),
        datePrecision: "DAY",
        nights: null,
        status: "cancelled",
      },
    });
    expect(attestStation(cancelled, NOW)).toBeNull();
  });

  it("a station still ahead proves nothing yet", () => {
    expect(attestStation(station({ startDate: d("2026-10-01") }), NOW)).toBeNull();
  });

  it("a stay station without own dates reads its stay's exact days", () => {
    const linked = station({
      lodgingStayId: "s1",
      startDate: null,
      lodgingStay: {
        checkIn: d("2024-07-12"),
        checkOut: d("2024-07-13"),
        datePrecision: "DAY",
        nights: null,
        status: "completed",
      },
    });
    expect(attestStation(linked, NOW)).toMatchObject({
      night: true,
      days: ["2024-07-12", "2024-07-13"],
    });
  });

  it("a roadtrip whose earliest station lies in the future has not started", () => {
    expect(roadtripHasStarted([station({ startDate: d("2027-01-01") })], NOW)).toBe(false);
    expect(roadtripHasStarted([station()], NOW)).toBe(true);
  });
});
