import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClockChangeNotice } from "../../common/ClockChangeNotice";
import { knownStationZone } from "../railFormModel";
import { makeRailJourney } from "./railJourneyFixture";

/**
 * The rail form in the repeated hour (ADR 0002 Q5).
 *
 * The rail write path cannot take `fold` yet — its schema has no such field,
 * so a "later" choice would be dropped on save and the earlier occurrence
 * stored while the form said otherwise. Until the server accepts it, the form
 * SAYS which occurrence is saved and offers no choice.
 */
describe("rail — clock change beside the time", () => {
  it("tells the user the earlier occurrence is saved, without a choice it cannot keep", () => {
    render(<ClockChangeNotice local="2027-10-31T02:30" zone="Europe/Berlin" />);
    expect(screen.getByText(/zweimal|twice|clockChange\.repeated/i)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("knows the station's zone only while the station is the stored one", () => {
    const journey = makeRailJourney({
      depLat: 50.107,
      depLon: 8.663,
      depTimezone: "Europe/Berlin",
    });
    const stored = {
      name: "Frankfurt",
      lat: 50.107,
      lon: 8.663,
      country: "DE",
      code: null,
      stationId: null,
    };
    expect(knownStationZone(journey, "dep", stored)).toBe("Europe/Berlin");
    expect(knownStationZone(journey, "dep", { ...stored, lat: 48.14, lon: 11.56 })).toBeNull();
    expect(knownStationZone(null, "dep", stored)).toBeNull();
  });
});
