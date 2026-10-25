import { judgePoint } from "../../classify";
import { overlandBatch, TEST_LAT, TEST_LON } from "../__fixtures__/requests";
import { mapOverland, normaliseOffset, overlandBodySchema } from "../overland";

/**
 * Overland batches as TravTrack points (TravTrack plan E9): every Point
 * feature becomes a point, `-0700` offsets are read as `-07:00`, negative
 * accuracy and speed are unknown, and a malformed feature is counted.
 */

const parse = (body: unknown) => mapOverland(overlandBodySchema.parse(body));

describe("mapOverland", () => {
  it("the recorded Overland batch stores every point", () => {
    const mapped = parse(overlandBatch);
    expect(mapped.invalid).toBe(0);
    expect(mapped.points).toHaveLength(3);
    expect(mapped.points[0]).toEqual({
      id: `2026-10-20T01:00:00-07:00:${TEST_LON}:${TEST_LAT}`,
      t: "2026-10-20T01:00:00-07:00",
      lat: TEST_LAT,
      lon: TEST_LON,
      accuracy: 8,
      altitude: 12,
      speed: 4.2,
      course: null,
      motion: "walking",
      purpose: "everyday",
    });
    expect(mapped.points[1]).toMatchObject({ motion: "automotive", course: 90 });
    for (const [i, p] of mapped.points.entries()) expect(judgePoint(p, i).kind).toBe("point");
  });

  it("a -0700 offset is read as -07:00", () => {
    expect(normaliseOffset("2026-10-20T01:00:00-0700")).toBe("2026-10-20T01:00:00-07:00");
    expect(normaliseOffset("2026-10-20T01:00:00+0530")).toBe("2026-10-20T01:00:00+05:30");
    expect(normaliseOffset("2026-10-20T08:00:00Z")).toBe("2026-10-20T08:00:00Z");
    expect(normaliseOffset("2026-10-20T08:00:00.250+02:00")).toBe("2026-10-20T08:00:00.250+02:00");
    expect(Date.parse(parse(overlandBatch).points[0].t as string)).toBe(
      Date.parse("2026-10-20T08:00:00Z")
    );
  });

  it("negative accuracy or speed is stored as unknown", () => {
    const third = parse(overlandBatch).points[2];
    expect(third).toMatchObject({ accuracy: null, speed: null, motion: null });
    expect(judgePoint(third, 0).kind).toBe("point");
  });

  it("a timestamp without an offset is not a point; a feature that is not a Point is counted", () => {
    const [good] = overlandBatch.locations;
    const mapped = parse({
      locations: [
        good,
        { ...good, properties: { ...good.properties, timestamp: "2026-10-20T01:00:00" } },
        { ...good, geometry: { type: "LineString", coordinates: [] } },
        { type: "Feature" },
      ],
    });
    expect(mapped.points).toHaveLength(1);
    expect(mapped.invalid).toBe(3);
  });

  it("an empty batch is valid and holds nothing; a body without locations is refused", () => {
    expect(parse({ locations: [] }).points).toEqual([]);
    expect(overlandBodySchema.safeParse({}).success).toBe(false);
    expect(overlandBodySchema.safeParse({ locations: "x" }).success).toBe(false);
  });

  it("a timestamp outside the accepted years is invalid; siblings stay", () => {
    const [good] = overlandBatch.locations;
    const at = (timestamp: string) => ({
      ...good,
      properties: { ...good.properties, timestamp },
    });
    const mapped = parse({
      locations: [
        good,
        at("+275760-09-13T00:00:00Z"),
        at("1970-01-01T00:00:00+0000"),
        at("2999-01-01T00:00:00Z"),
        at("2026-13-45T99:00:00Z"),
      ],
    });
    expect(mapped.points).toHaveLength(1);
    expect(mapped.invalid).toBe(4);
  });
});
