import { computeAircraftRanking } from "../aircraftRanking";
import { normalizeRegistration } from "../../../shared/aircraftRegistration";

/** forgejo#256 — one airframe, one key, whatever case or spacing it was typed in. */
const hull = (aircraftRegistration: string | null) => ({
  aircraftRegistration,
  airline: null,
  aircraft: null,
  depLat: 0,
  depLon: 0,
  arrLat: 0,
  arrLon: 1,
  departureTime: new Date("2026-05-01T06:00:00Z"),
});

describe("the hull ranking keys a registration once", () => {
  it("counts 'D-AIXA', 'd-aixa' and ' D-AIXA ' as one aircraft flown three times", () => {
    const ranking = computeAircraftRanking([hull("D-AIXA"), hull("d-aixa"), hull(" D-AIXA ")]);
    expect(ranking.aircraft).toHaveLength(1);
    expect(ranking.aircraft[0]).toMatchObject({ registration: "D-AIXA", count: 3 });
  });

  it("normalises to upper case without inner spaces, keeps hyphens, and drops an empty mark", () => {
    expect(normalizeRegistration(" n 123ab ")).toBe("N123AB");
    expect(normalizeRegistration("d-aixa")).toBe("D-AIXA");
    expect(normalizeRegistration("   ")).toBeNull();
    expect(normalizeRegistration(null)).toBeNull();
  });
});
