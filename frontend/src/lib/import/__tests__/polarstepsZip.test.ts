import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { PolarstepsZipError, looksLikeZip, polarstepsTextFromZip } from "../polarstepsZip";

/** SYNTHETIC archive — the layout of the documented Polarsteps download, not a real one. */
const trip = (name: string) => ({
  name,
  all_steps: [{ name: "Lisbon", location: { lat: 38.7, lon: -9.1 } }],
});
const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const kind = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as PolarstepsZipError).kind;
  }
  return null;
};

describe("polarstepsTextFromZip", () => {
  it("collects every trip.json into one array and leaves the rest of the download alone", () => {
    const bytes = zip({
      "user/user.json": "{}",
      "trip/a_1/trip.json": JSON.stringify(trip("A")),
      "trip/a_1/locations.json": '{"locations":[]}',
      "trip/b_2/trip.json": JSON.stringify(trip("B")),
      "trip/b_2/photo.jpg": "not really a picture",
    });
    const parsed = JSON.parse(polarstepsTextFromZip(bytes, 1_000_000));
    expect(parsed.map((t: { name: string }) => t.name)).toEqual(["A", "B"]);
  });

  it("refuses a file that is not a ZIP, a ZIP without a trip, and a trip that is not JSON", () => {
    expect(looksLikeZip(strToU8("{}"))).toBe(false);
    expect(kind(() => polarstepsTextFromZip(strToU8('{"name":"x"}'), 1000))).toBe("notZip");
    expect(kind(() => polarstepsTextFromZip(zip({ "user/user.json": "{}" }), 1000))).toBe("noTrip");
    expect(kind(() => polarstepsTextFromZip(zip({ "t/trip.json": "{{" }), 1000))).toBe("invalid");
  });

  it("does not inflate a trip.json that claims more than the ceiling", () => {
    const big = zip({ "t/trip.json": JSON.stringify(trip("x".repeat(5000))) });
    expect(kind(() => polarstepsTextFromZip(big, 1000))).toBe("tooLarge");
  });

  it("refuses an archive where one trip is too large, instead of importing only the others", () => {
    const mixed = zip({
      "a/trip.json": JSON.stringify(trip("small")),
      "b/trip.json": JSON.stringify(trip("x".repeat(5000))),
    });
    expect(kind(() => polarstepsTextFromZip(mixed, 1000))).toBe("tooLarge");
  });
});
