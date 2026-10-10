import { classifyTakeoutKind, suggestTreatment } from "../takeoutKind";
import { countryOfListName } from "../takeoutTrip";

/**
 * #358 point 4: a saved station, fuel stop, shop, airport or hotel is offered
 * as a trip stop (or the stay it is), a whole city as skip — as a SUGGESTION.
 */
describe("classifyTakeoutKind", () => {
  it.each([
    [["airport", "point_of_interest"], "airport"],
    [["train_station", "transit_station"], "station"],
    [["gas_station", "store"], "fuel"],
    [["lodging", "point_of_interest"], "lodging"],
    [["locality", "political"], "city"],
    [["supermarket", "store"], "shop"],
    [["museum", "tourist_attraction"], "sight"],
  ])("reads Google types %j as %s", (types, kind) => {
    expect(classifyTakeoutKind({ name: "x", googleTypes: types })).toBe(kind);
  });

  it("does not call a cathedral with a gift shop a shop", () => {
    expect(
      classifyTakeoutKind({ name: "Dom", googleTypes: ["church", "store", "political"] })
    ).toBe("sight");
  });

  it("reads Photon's OSM value, then the name", () => {
    expect(classifyTakeoutKind({ name: "Oslo S", osmType: "station" })).toBe("station");
    expect(classifyTakeoutKind({ name: "Bergen", osmType: "city" })).toBe("city");
    expect(classifyTakeoutKind({ name: "Hotel Alpenblick" })).toBe("lodging");
    expect(classifyTakeoutKind({ name: "Circle K Lillehammer" })).toBe("fuel");
    expect(classifyTakeoutKind({ name: "München Hbf" })).toBe("station");
    expect(classifyTakeoutKind({ name: "Flughafen Wien" })).toBe("airport");
    expect(classifyTakeoutKind({ name: "Preikestolen" })).toBe("sight");
  });
});

describe("suggestTreatment", () => {
  it("skips a city and keeps a sight a place", () => {
    expect(suggestTreatment("city", { hasTrip: true, hasMatchedStay: false })).toBe("skip");
    expect(suggestTreatment("sight", { hasTrip: true, hasMatchedStay: false })).toBe("place");
  });

  it("offers a stop only where there is a trip to put it on", () => {
    expect(suggestTreatment("fuel", { hasTrip: true, hasMatchedStay: false })).toBe("trip_stop");
    expect(suggestTreatment("fuel", { hasTrip: false, hasMatchedStay: false })).toBe("place");
  });

  it("offers a hotel as the user's stay only when one was found", () => {
    expect(suggestTreatment("lodging", { hasTrip: true, hasMatchedStay: true })).toBe("stay");
    expect(suggestTreatment("lodging", { hasTrip: true, hasMatchedStay: false })).toBe("trip_stop");
  });
});

describe("countryOfListName", () => {
  it("reads a list named after a country, in German or English, with a year", () => {
    expect(countryOfListName("Japan.csv")).toBe("JP");
    expect(countryOfListName("Norwegen 2024")).toBe("NO");
    expect(countryOfListName("Norway")).toBe("NO");
  });

  it("abstains for a list that names no country, and for two-letter words", () => {
    expect(countryOfListName("Gespeicherte Orte")).toBeNull();
    expect(countryOfListName("Me")).toBeNull();
    expect(countryOfListName(null)).toBeNull();
  });
});
