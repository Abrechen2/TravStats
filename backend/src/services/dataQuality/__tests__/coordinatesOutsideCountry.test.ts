/**
 * The fourth check of design §3.5: the stored point against the stored country.
 *
 * Most of what follows pins the SILENCE. A boundary check is the one of the
 * four that can flood an inbox — every lodging and every place carries
 * coordinates, and a 1:10m outline does not agree with reality at the metre —
 * so the abstentions matter more here than the positive case does. An inbox
 * with noise in it is one nobody reads, and then the three checks that ARE
 * quiet stop being read too.
 */
import { describe, it, expect } from "@jest/globals";

import {
  findCoordinatesOutsideCountry,
  type CoordinateCountryLookup,
  type LocatedRecord,
} from "../checks/coordinatesOutsideCountry";

const record = (over: Partial<LocatedRecord> = {}): LocatedRecord => ({
  entityType: "lodging",
  id: "l1",
  lat: 46.0,
  lon: 15.1,
  country: null,
  isoCountryCode: "SI",
  ...over,
});

/**
 * A lookup with a hand-drawn world: latitude decides the country, so a case
 * reads as "the point is in X" without a 10 MB file or a real ray cast.
 */
const lookup = (
  at: (lat: number, lon: number) => string | null,
  codes: string[] = ["SI", "RO", "US", "DE"]
): CoordinateCountryLookup => ({ countryAt: at, codes: new Set(codes) });

const always = (code: string | null) => lookup(() => code);

describe("findCoordinatesOutsideCountry", () => {
  it("flags a point that falls squarely in a different country", () => {
    const findings = findCoordinatesOutsideCountry(
      [record({ isoCountryCode: "SI", lat: 44.43, lon: 26.1 })],
      always("RO")
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      entityType: "lodging",
      entityId: "l1",
      kind: "coordinates_outside_country",
      details: { claimedCountryCode: "SI", coordinateCountryCode: "RO", lat: 44.43, lon: 26.1 },
    });
  });

  it("says nothing when the point agrees with the record", () => {
    expect(findCoordinatesOutsideCountry([record()], always("SI"))).toEqual([]);
  });

  it("treats the sea as an abstention, not a disagreement", () => {
    // `countryAt` answers null outside every outline. A hotel on a spit of
    // land, a port, or an island smaller than the outlines lands there
    // routinely — flagging it would report the dataset's resolution as the
    // user's mistake.
    expect(findCoordinatesOutsideCountry([record()], always(null))).toEqual([]);
  });

  it("stays quiet about a country the dataset cannot see", () => {
    // The vendored outlines omit the territories Natural Earth does not
    // attribute. A claim outside `codes` could only ever come back "wrong",
    // for every record naming it, and none of that would be the user's doing.
    const findings = findCoordinatesOutsideCountry(
      [record({ isoCountryCode: "XK" })],
      lookup(() => "RS", ["SI", "RS"])
    );

    expect(findings).toEqual([]);
  });

  it("says nothing about a record with no coordinates", () => {
    expect(findCoordinatesOutsideCountry([record({ lat: null, lon: null })], always("RO"))).toEqual(
      []
    );
    // One half is not a point either.
    expect(findCoordinatesOutsideCountry([record({ lon: null })], always("RO"))).toEqual([]);
  });

  it("says nothing about a record that claims no country", () => {
    // Abstention is a result: a gap is not a contradiction. This is also what
    // keeps a freshly imported row, geocoded but not yet resolved, out of the
    // inbox.
    const findings = findCoordinatesOutsideCountry(
      [record({ isoCountryCode: null, country: null })],
      always("RO")
    );

    expect(findings).toEqual([]);
  });

  it("falls back to the free-text country for a row written before the code existed", () => {
    const findings = findCoordinatesOutsideCountry(
      [record({ isoCountryCode: null, country: "Germany", lat: 44.43, lon: 26.1 })],
      always("RO")
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].details).toMatchObject({ claimedCountryCode: "DE" });
  });

  it("checks places on the same terms as lodgings", () => {
    const findings = findCoordinatesOutsideCountry(
      [record({ entityType: "place", id: "p1" })],
      always("RO")
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ entityType: "place", entityId: "p1" });
  });

  it("produces one stable finding per record, so a re-run writes nothing new", () => {
    // The runner reconciles on (entityType, entityId, kind). Two runs over
    // unchanged data must produce identical identities or the inbox rewrites
    // itself for ever.
    const records = [record(), record({ id: "l2", entityType: "place" })];
    const once = findCoordinatesOutsideCountry(records, always("RO"));
    const twice = findCoordinatesOutsideCountry(records, always("RO"));

    expect(once).toEqual(twice);
    expect(new Set(once.map((f) => `${f.entityType} ${f.entityId} ${f.kind}`)).size).toBe(2);
  });
});
