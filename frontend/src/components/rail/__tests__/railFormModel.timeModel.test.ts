import { describe, it, expect } from "vitest";
import { saveErrorFrom, draftFrom, toRailInput } from "../railFormModel";
import { germanT } from "../../../__tests__/helpers/germanT";

const refused = (code: string, field?: string) => ({
  isAxiosError: true,
  response: { status: 422, data: { error: "English prose for a log", code, field } },
});

/**
 * The rail form under the time model (ADR 0002). Its wall clock is the
 * station's, and the station travels in the same body — a catalogue row by
 * id, a geocoder pick by position — so the server resolves the zone from it;
 * the form never sends one of its own. What it must do is read the time
 * model's refusals as German sentences.
 */
describe("rail form — time model", () => {
  it("the general gap code lands on the time field with the clock-change sentence", () => {
    const error = saveErrorFrom(refused("LOCAL_TIME_NONEXISTENT", "departureLocal"));
    expect(error.field).toBe("departureLocal");
    expect(germanT(error.key)).toMatch(/Sommerzeit/);
  });

  it("TZ_UNRESOLVED says the station has no zone; a stale bundle is asked to reload", () => {
    expect(germanT(saveErrorFrom(refused("TZ_UNRESOLVED")).key)).toMatch(/keine Zeitzone bekannt/);
    expect(germanT(saveErrorFrom(refused("TIME_SHAPE_REQUIRED")).key)).toMatch(
      /lade die Seite neu/
    );
    expect(germanT(saveErrorFrom(refused("TIMEZONE_LOOKUP_UNAVAILABLE")).key)).toMatch(
      /gerade nicht bestimmen/
    );
  });

  it("sends the station wall clock with the station it belongs to — catalogue id or position", () => {
    const base = draftFrom(null);
    const catalogue = toRailInput({
      ...base,
      departure: {
        name: "Köln Hbf",
        lat: 50.94,
        lon: 6.96,
        country: "DE",
        code: "8000207",
        stationId: 17,
      },
      arrival: {
        name: "Bahnhof X",
        lat: 48.1,
        lon: 11.5,
        country: "DE",
        code: null,
        stationId: null,
      },
      departureLocal: "2027-10-31T02:30",
      arrivalLocal: "2027-10-31T06:10",
    });
    expect(catalogue.departureLocal).toBe("2027-10-31T02:30");
    expect(catalogue.departureStation).toMatchObject({ stationId: 17 });
    expect(catalogue.arrivalStation).toMatchObject({ stationId: null, lat: 48.1, lon: 11.5 });
    expect(catalogue).not.toHaveProperty("depTimezone");
  });
});
