import { buildCountryDetail, type CountryDetailRoadtripStation } from "../countryDetail";

/**
 * The drill-down behind a passport row raised by a roadtrip station must name
 * the station AND link the roadtrip, where it can be edited (owner rule: every
 * number names its evidence and links the editable record). Without it the
 * row exists and its page answers 404.
 */
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const station = (
  over: Partial<CountryDetailRoadtripStation> = {}
): CountryDetailRoadtripStation => ({
  roadtripId: "rt1",
  roadtripName: "Skandinavien",
  stationId: "st1",
  title: "Preikestolen Camping",
  country: "NO",
  night: true,
  at: d("2024-07-14"),
  days: ["2024-07-14", "2024-07-15"],
  ...over,
});

const detailOf = (code: string, stations: CountryDetailRoadtripStation[]) =>
  buildCountryDetail(code, [], new Map(), [], [], [], [], [], undefined, stations);

describe("buildCountryDetail — roadtrip stations", () => {
  it("answers for a country only a roadtrip station proves, naming and linking the station", () => {
    const detail = detailOf("NO", [station()]);
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({ evidence: "roadtrip", roadtripStations: 1, firstYear: 2024 });
    expect(detail?.timeline).toEqual([
      {
        kind: "roadtrip",
        date: "2024-07-14",
        roadtripId: "rt1",
        roadtripName: "Skandinavien",
        stationId: "st1",
        stationTitle: "Preikestolen Camping",
      },
    ]);
  });

  it("leaves out stations standing in another country", () => {
    expect(detailOf("SE", [station()])).toBeNull();
  });
});
