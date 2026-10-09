/**
 * forgejo#273 — the country page (and the passport evidence panel built on it,
 * `services/evidence/metricEvidencePassport.ts`) dates a flight by its day at
 * the DEPARTURE airport, the day the passport row files it under. It used the
 * stored instant's UTC day, so a Tokyo 07:30 departure appeared one day — and
 * on 1 January one year — early.
 */
import { buildCountryDetail, type CountryDetailFlight } from "../countryDetail";

const flight = (
  id: string,
  dep: string,
  arr: string,
  departureTime: string,
  localDay: string | null | undefined
): CountryDetailFlight => ({
  id,
  flightNumber: "NH1",
  depIata: dep,
  depLat: 35.76,
  depLon: 140.39,
  arrIata: arr,
  arrLat: 48.35,
  arrLon: 11.78,
  departureTime: new Date(departureTime),
  status: "flown",
  localDay,
});

const countries = new Map([
  ["NRT", "Japan"],
  ["MUC", "Germany"],
  ["JFK", "United States"],
]);

describe("buildCountryDetail — the departure airport's day", () => {
  it("dates a Tokyo 07:30 departure on 1 January on that day and year", () => {
    // 07:30 JST on 2026-01-01 is 22:30Z on 2025-12-31.
    const detail = buildCountryDetail(
      "JP",
      [flight("a", "NRT", "MUC", "2025-12-31T22:30:00Z", "2026-01-01")],
      countries
    );
    expect(detail?.timeline[0]).toMatchObject({ kind: "flight", date: "2026-01-01" });
    expect(detail?.airports[0]).toMatchObject({ iata: "NRT", firstDate: "2026-01-01" });
    expect(detail?.firstYear).toBe(2026);
    expect(detail?.lastYear).toBe(2026);
  });

  it("dates a New York departure at 22:00 on 31 December on that day", () => {
    // 22:00 EST is 03:00Z the next morning.
    const detail = buildCountryDetail(
      "US",
      [flight("b", "JFK", "MUC", "2026-01-01T03:00:00Z", "2025-12-31")],
      countries
    );
    expect(detail?.timeline[0]).toMatchObject({ date: "2025-12-31" });
    expect(detail?.lastYear).toBe(2025);
  });

  it("falls back to the stored day when no local day was resolved", () => {
    const detail = buildCountryDetail(
      "JP",
      [flight("c", "NRT", "MUC", "2025-12-31T22:30:00Z", undefined)],
      countries
    );
    expect(detail?.timeline[0]).toMatchObject({ date: "2025-12-31" });
  });
});
