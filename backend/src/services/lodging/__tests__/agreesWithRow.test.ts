import { agreesWithRow } from "../geocodeBackfill";
import type { GeocodeSubject, ResolvedCoordinates } from "../geocodeBackfill";

const row = (over: Partial<GeocodeSubject> = {}): GeocodeSubject => ({
  name: "Hotel St. Martin",
  type: "hotel",
  chainId: null,
  address: "Wiesenstr. 21, 87616",
  city: "Marktoberdorf",
  country: "Deutschland",
  ...over,
});

const found = (over: Partial<ResolvedCoordinates> = {}): ResolvedCoordinates => ({
  lat: 47.77,
  lon: 10.61,
  source: "google",
  city: "Marktoberdorf",
  countryName: "Deutschland",
  ...over,
});

describe("a located hit must not contradict the row", () => {
  it("rejects the namesake in another country", () => {
    // The real defect: asked for "Hotel St. Martin", Places answered with the
    // one in ROME. The card kept its Bavarian address and the map showed Italy.
    expect(agreesWithRow(row(), found({ city: "Rom", countryName: "Italien", lat: 41.9, lon: 12.5 }))).toBe(false);
  });

  it("rejects the namesake in another town of the same country", () => {
    expect(agreesWithRow(row(), found({ city: "Hamburg" }))).toBe(false);
  });

  it("accepts the match the row is actually about", () => {
    expect(agreesWithRow(row(), found())).toBe(true);
  });

  it("accepts a row that knows nothing about its place — that is what the tier is FOR", () => {
    // A life-list line is often just a name. There is nothing to contradict,
    // so the answer is kept; rejecting it would disable the whole feature.
    expect(agreesWithRow(row({ city: null, country: null }), found({ city: "Shanghai", countryName: "China" }))).toBe(true);
  });

  it("does not mistake spelling for disagreement", () => {
    expect(agreesWithRow(row({ city: "Zürich", country: "Schweiz" }), found({ city: "Zurich", countryName: "Schweiz" }))).toBe(true);
    expect(agreesWithRow(row({ city: "Frankfurt" }), found({ city: "Frankfurt am Main" }))).toBe(true);
    expect(agreesWithRow(row({ city: "Rom", country: "Italien" }), found({ city: "Roma", countryName: "Italien" }))).toBe(true);
  });
});
