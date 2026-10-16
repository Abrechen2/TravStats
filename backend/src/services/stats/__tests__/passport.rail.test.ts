/**
 * A completed train ride is country evidence (2.7). The Stats overview already
 * counted a ride's countries while the passport and the country drill-down did
 * not know them — the same account showed two country totals on two pages.
 *
 * Since the owner ruling of 2026-10-16 a ride counts like a flight, in one
 * chain with flights and coaches (forgejo#299): see
 * `passport.surfaceChains.test.ts` for the round trip, the change station,
 * the open chain and the mixed flight-out/train-back case.
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

/**
 * Owner ruling 2026-10-16 (forgejo#299): what a ride PROVES is graded by the
 * travel chain (`journeyEvidence.ts`, pinned in `passport.surfaceChains.test.ts`),
 * not here. `railEnds` only names the station ends and hands each its ride as
 * a chain leg — these pin that hand-over.
 */
describe("railEnds — the station ends of a ride, each carrying its leg", () => {
  it("names both ends with their own day, and skips a station without a country", () => {
    const ends = railEnds([ride({ id: "a", arrCountry: null })]);
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ country: "DE", days: ["2025-03-01"] });
    // The leg still knows the arrival is unplaced, so the chain cannot read a
    // return out of a missing country.
    expect(ends[0].leg).toMatchObject({
      mode: "rail",
      depCountry: "DE",
      arrCountry: null,
      depDay: "2025-03-01",
      arrDay: "2025-03-01",
    });
  });

  it("files a bus ride's ends as `bus` legs", () => {
    expect(railEnds([ride({ id: "a" })], "bus")[0].leg.mode).toBe("bus");
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
      tier: "transited",
      counted: false,
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
