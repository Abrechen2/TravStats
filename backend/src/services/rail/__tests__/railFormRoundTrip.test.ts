import { mergeRailJourney, type RailJourneyState } from "../railJourneyWrite";
import { draftFrom, toRailInput } from "../../../../../frontend/src/components/rail/railFormModel";
import { makeRailJourney } from "../../../../../frontend/src/components/rail/__tests__/railJourneyFixture";
import type { RailJourney } from "../../../../../frontend/src/types/rail";

// The model takes one constant from a component file the backend's transform
// cannot read (JSX); the round trip never touches it.
jest.mock("../../../../../frontend/src/components/rail/RailStationField", () => ({
  EMPTY_STATION: {
    name: "",
    lat: null,
    lon: null,
    country: null,
    code: null,
    stationId: null,
  },
}));

/**
 * The web form's model against the real write path, for the one case a
 * per-side test cannot see (forgejo#251): the form keeps the station wall
 * clock, the server turns it back into an instant, and in the repeated autumn
 * hour that is two instants. An edit that touches no time must land on the
 * stored one.
 */
const STORED_LATER = "2026-10-25T01:30:00.000Z"; // 02:30 CET, the second 02:30 in Berlin

const state: RailJourneyState = {
  depStationName: "Berlin Hbf",
  depStationCode: null,
  depStationId: null,
  depLat: 52.525,
  depLon: 13.369,
  depCountry: "DE",
  depTimezone: "Europe/Berlin",
  arrStationName: "Hamburg Hbf",
  arrStationCode: null,
  arrStationId: null,
  arrLat: 53.553,
  arrLon: 10.006,
  arrCountry: "DE",
  arrTimezone: "Europe/Berlin",
  departureTime: new Date(STORED_LATER),
  arrivalTime: null,
  depPrecision: "minute",
  arrPrecision: null,
  distanceKm: 255,
  distanceSource: "great_circle",
  status: "scheduled",
};

// The wire shape the web reads back (`times`), as the server's DTO builds it.
const wire: RailJourney = makeRailJourney({
  depStationName: state.depStationName,
  depLat: state.depLat,
  depLon: state.depLon,
  depCountry: "DE",
  depTimezone: "Europe/Berlin",
  arrStationName: state.arrStationName,
  arrLat: state.arrLat,
  arrLon: state.arrLon,
  arrCountry: "DE",
  arrTimezone: "Europe/Berlin",
  departureTime: STORED_LATER,
  arrivalTime: null,
  times: {
    departure: {
      utc: STORED_LATER,
      zone: "Europe/Berlin",
      offset: "+01:00",
      local: "2026-10-25T02:30:00",
      precision: "minute",
    },
    arrival: null,
    actualDeparture: null,
    actualArrival: null,
  },
});

describe("rail form round trip in a repeated hour", () => {
  it("keeps the stored later occurrence when only the seat changes", () => {
    const draft = { ...draftFrom(wire), seat: "42" };
    const input = toRailInput(draft);
    const merged = mergeRailJourney(
      state,
      input as unknown as Parameters<typeof mergeRailJourney>[1]
    );
    expect(merged.departureTime.toISOString()).toBe(STORED_LATER);
  });

  it("would have moved it an hour back without the fold (the defect)", () => {
    const input = { ...toRailInput(draftFrom(wire)), departureFold: null };
    const merged = mergeRailJourney(
      state,
      input as unknown as Parameters<typeof mergeRailJourney>[1]
    );
    expect(merged.departureTime.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});
