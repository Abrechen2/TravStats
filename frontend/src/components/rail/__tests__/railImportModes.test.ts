import { describe, expect, it } from "vitest";
import { stationDraftFrom, rowsFrom, totalGoesTo } from "../railImportModel";
import { groupChoice, legStart, railTransitModeOf, toBusInput } from "../railImportModes";
import { isCountableRail } from "../../../shared/railCounting";
import { journeyFromRail } from "../../map/cards/journeys/journeyNormalize";
import type { RailImportLeg } from "../../../types/rail";
import { booking, leg, station } from "./railImportFixture";

const withMode = (
  mode: NonNullable<RailImportLeg["transit"]>["mode"],
  busKind: "city" | "replacement" | "coach" | null = null,
  over: Partial<RailImportLeg> = {}
): RailImportLeg => leg({ transit: { mode, busKind }, ...over });

const OFF = { localTransit: "skip", bus: "skip", busEnabled: true } as const;
const ON = { localTransit: "rail", bus: "bus", busEnabled: true } as const;

describe("legStart — how each kind of leg starts", () => {
  it.each([
    ["a train", withMode("rail"), OFF, { selected: true, saveAs: "rail" }],
    ["an unclassified leg", withMode("unknown"), OFF, { selected: true, saveAs: "rail" }],
    ["a document's leg", leg(), OFF, { selected: true, saveAs: "rail" }],
    ["a U-Bahn", withMode("metro"), OFF, { selected: false, saveAs: "rail" }],
    ["a tram", withMode("tram"), OFF, { selected: false, saveAs: "rail" }],
    ["a city bus", withMode("bus", "city"), OFF, { selected: false, saveAs: "bus" }],
    ["a Fernbus", withMode("bus", "coach"), OFF, { selected: false, saveAs: "bus" }],
    ["a remembered U-Bahn", withMode("metro"), ON, { selected: true, saveAs: "rail" }],
    ["a remembered bus", withMode("bus", "replacement"), ON, { selected: true, saveAs: "bus" }],
    ["a ferry", withMode("ferry"), ON, { selected: false, saveAs: null }],
  ] as const)("%s", (_label, l, defaults, expected) => {
    expect(legStart(l, defaults)).toEqual(expected);
  });

  it("offers a bus only when the account has the bus domain, whatever it remembered", () => {
    expect(legStart(withMode("bus", "city"), { ...ON, busEnabled: false })).toEqual({
      selected: false,
      saveAs: null,
    });
  });

  it("starts a leg already in the logbook unticked, remembered or not", () => {
    expect(legStart(withMode("tram", null, { duplicateOf: "j1" }), ON).selected).toBe(false);
  });
});

describe("the rest of the model", () => {
  it("places a stop bahn.de placed, with no catalogue id", () => {
    const draft = stationDraftFrom({
      ...station("Odeonsplatz", false),
      lat: 48.14,
      lon: 11.57,
      country: "DE",
      code: "8000999",
      positionSource: "provider",
    });
    expect(draft).toEqual({
      name: "Odeonsplatz",
      lat: 48.14,
      lon: 11.57,
      country: "DE",
      code: "8000999",
      stationId: null,
    });
    expect(stationDraftFrom(station("Nirgendwo", false)).lat).toBeNull();
  });

  it("stores a U-Bahn or tram as its mode, anything else as a train", () => {
    expect(railTransitModeOf(withMode("metro"))).toBe("metro");
    expect(railTransitModeOf(withMode("tram"))).toBe("tram");
    expect(railTransitModeOf(withMode("unknown"))).toBe("rail");
    expect(railTransitModeOf(leg())).toBe("rail");
  });

  it("puts the total on the first ticked rail leg, never on a bus ride", () => {
    const rows = rowsFrom(booking({ legs: [withMode("bus", "city"), withMode("rail")] }), ON);
    expect(totalGoesTo(rows)).toBe(1);
  });

  it("remembers a group's choice only when its legs agree", () => {
    const tram = withMode("tram");
    expect(groupChoice([{ leg: tram, selected: true }], "localTransit")).toBe("rail");
    expect(groupChoice([{ leg: tram, selected: false }], "localTransit")).toBe("skip");
    expect(
      groupChoice(
        [
          { leg: tram, selected: true },
          { leg: withMode("metro"), selected: false },
        ],
        "localTransit"
      )
    ).toBeNull();
    expect(groupChoice([{ leg: tram, selected: true }], "bus")).toBeNull();
  });

  it("files a Fernbus as an intercity ride, a city or replacement bus as other", () => {
    const row = (l: RailImportLeg) => ({
      leg: l,
      departure: stationDraftFrom(l.departureStation),
      arrival: stationDraftFrom(l.arrivalStation),
    });
    expect(toBusInput(booking(), row(withMode("bus", "coach"))).rideKind).toBe("intercity");
    expect(toBusInput(booking(), row(withMode("bus", "replacement"))).rideKind).toBe("other");
  });
});

describe("a tram ride in the web's own rail figures", () => {
  it("is not counted by the mirrored rule", () => {
    expect(isCountableRail({ status: "completed", transitMode: "rail" })).toBe(true);
    expect(isCountableRail({ status: "completed", transitMode: "tram" })).toBe(false);
    expect(isCountableRail({ status: "completed", transitMode: "metro" })).toBe(false);
  });

  it("is drawn on the map but tallied neither travelled nor planned", () => {
    const base = {
      id: "r1",
      status: "completed",
      depStationName: "Marienplatz",
      depLat: 48.137,
      depLon: 11.575,
      arrStationName: "Odeonsplatz",
      arrLat: 48.142,
      arrLon: 11.577,
    };
    const tram = journeyFromRail({ ...base, transitMode: "tram" } as Parameters<
      typeof journeyFromRail
    >[0]);
    expect(tram).toMatchObject({ travelled: false, planned: false });
    const train = journeyFromRail({ ...base, transitMode: "rail" } as Parameters<
      typeof journeyFromRail
    >[0]);
    expect(train).toMatchObject({ travelled: true, planned: false });
  });
});
