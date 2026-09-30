/**
 * A completed train ride is country evidence (2.7). The Stats overview already
 * counted a ride's countries while the passport and the country drill-down did
 * not know them — the same account showed two country totals on two pages.
 *
 * The tier is structural, as for flights: an arrival and the next departure
 * from that country on another day is `slept`; on the same day it is a day trip
 * (`visited`) when the next ride goes back, a change of trains (`transited`)
 * when it goes on; an end with no partner is `visited`.
 */
import { buildPassport } from "../passport";
import { buildCountryDetail } from "../countryDetail";
import { railEnds, type RailEvidenceRide } from "../railEvidence";

const NOW = new Date("2026-09-25T12:00:00Z");

const ride = (
  over: Partial<RailEvidenceRide> & Pick<RailEvidenceRide, "id">
): RailEvidenceRide => ({
  label: `ride ${over.id}`,
  depStationName: "Frankfurt (Main) Hbf",
  arrStationName: "Basel SBB",
  depCountry: "DE",
  arrCountry: "CH",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Zurich",
  departureTime: new Date("2025-03-01T07:00:00Z"),
  arrivalTime: new Date("2025-03-01T10:00:00Z"),
  ...over,
});

const tierOf = (ends: ReturnType<typeof railEnds>, rideId: string, country: string) =>
  ends.find((e) => e.rideId === rideId && e.country === country)?.tier;

describe("railEnds — what a train ride proves", () => {
  it("grades an end with no partner `visited`, and skips a station without a country", () => {
    const ends = railEnds([ride({ id: "a", arrCountry: null })]);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ country: "DE", tier: "visited", days: ["2025-03-01"] });
  });

  it("grades a change of trains on the same day `transited`", () => {
    const ends = railEnds([
      ride({ id: "a" }),
      ride({
        id: "b",
        depStationName: "Basel SBB",
        depCountry: "CH",
        depTimezone: "Europe/Zurich",
        arrStationName: "Milano Centrale",
        arrCountry: "IT",
        arrTimezone: "Europe/Rome",
        departureTime: new Date("2025-03-01T10:30:00Z"),
        arrivalTime: new Date("2025-03-01T14:00:00Z"),
      }),
    ]);
    expect(tierOf(ends, "a", "CH")).toBe("transited");
    expect(tierOf(ends, "b", "CH")).toBe("transited");
    expect(tierOf(ends, "b", "IT")).toBe("visited");
  });

  it("grades a same-day return `visited` and a night between two rides `slept`", () => {
    const back = (id: string, day: string) =>
      ride({
        id,
        depStationName: "Basel SBB",
        depCountry: "CH",
        depTimezone: "Europe/Zurich",
        arrStationName: "Frankfurt (Main) Hbf",
        arrCountry: "DE",
        arrTimezone: "Europe/Berlin",
        departureTime: new Date(`${day}T17:00:00Z`),
        arrivalTime: new Date(`${day}T20:00:00Z`),
      });
    expect(tierOf(railEnds([ride({ id: "a" }), back("b", "2025-03-01")]), "a", "CH")).toBe(
      "visited"
    );
    const overnight = railEnds([ride({ id: "a" }), back("b", "2025-03-03")]);
    expect(tierOf(overnight, "a", "CH")).toBe("slept");
    expect(overnight.find((e) => e.rideId === "a" && e.country === "CH")?.days).toEqual([
      "2025-03-01",
      "2025-03-03",
    ]);
  });

  it("reads the day on the station's clock, not in UTC", () => {
    // 23:30 UTC on the 1st is 00:30 on the 2nd in Zürich.
    const ends = railEnds([ride({ id: "a", arrivalTime: new Date("2025-03-01T23:30:00Z") })]);
    expect(ends.find((e) => e.country === "CH")?.days).toEqual(["2025-03-02"]);
  });
});

describe("passport and drill-down — rail", () => {
  const ends = railEnds([ride({ id: "r1", label: "ICE 5 · Frankfurt (Main) Hbf → Basel SBB" })]);

  it("raises a country reached only by train, with rail as its evidence", () => {
    const p = buildPassport([], new Map(), [], NOW, [], [], [], undefined, [], [], ends);
    expect(p.countries.find((c) => c.code === "CH")).toMatchObject({
      evidence: "rail",
      kinds: ["rail"],
      tier: "visited",
      counted: true,
      firstYear: 2025,
    });
    expect(p.summary.byEvidence.rail).toBe(2); // CH and DE
  });

  it("names and links the ride behind the country", () => {
    const detail = buildCountryDetail("CH", [], new Map(), [], [], [], [], [], undefined, [], ends);
    expect(detail).toMatchObject({ evidence: "rail", railRides: 1 });
    expect(detail?.timeline).toEqual([
      {
        kind: "rail",
        date: "2025-03-01",
        rideId: "r1",
        rideLabel: "ICE 5 · Frankfurt (Main) Hbf → Basel SBB",
        stationName: "Basel SBB",
      },
    ]);
  });
});
