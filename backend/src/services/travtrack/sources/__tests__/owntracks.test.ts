import { judgePoint } from "../../classify";
import {
  owntracksAndroidLocation,
  owntracksIosLocation,
  owntracksLwt,
  owntracksTransition,
  TEST_LAT,
  TEST_LON,
  TST,
} from "../__fixtures__/requests";
import { mapOwnTracks } from "../owntracks";

/**
 * OwnTracks messages as TravTrack points (TravTrack plan E9): a location
 * becomes one point, everything else — and an empty POST — is nothing, and a
 * malformed message is counted, never a refusal of the request.
 */

describe("mapOwnTracks", () => {
  it("the recorded OwnTracks location becomes one point with speed in m/s", () => {
    const mapped = mapOwnTracks(owntracksAndroidLocation);
    expect(mapped).toMatchObject({ messages: 1, ignored: 0, invalid: 0 });
    expect(mapped.points).toEqual([
      {
        id: `${TST}:${TEST_LAT}:${TEST_LON}`,
        t: "2026-10-20T08:00:00.000Z",
        lat: TEST_LAT,
        lon: TEST_LON,
        accuracy: 13,
        altitude: 42,
        speed: 5,
        course: 270,
        purpose: "everyday",
      },
    ]);
    expect(judgePoint(mapped.points[0], 0).kind).toBe("point");
  });

  it("an iOS location with unknown speed and course stores them as unknown", () => {
    const [p] = mapOwnTracks(owntracksIosLocation).points;
    expect(p).toMatchObject({ speed: null, course: null, accuracy: 5 });
    expect(judgePoint(p, 0).kind).toBe("point");
  });

  it("an empty OwnTracks POST and a transition store nothing", () => {
    for (const body of [undefined, null, {}, [], owntracksTransition, owntracksLwt]) {
      expect(mapOwnTracks(body).points).toEqual([]);
    }
    expect(mapOwnTracks([owntracksTransition, owntracksLwt])).toMatchObject({
      messages: 2,
      ignored: 2,
      invalid: 0,
    });
  });

  it("an array keeps its locations and counts a malformed one instead of refusing", () => {
    const mapped = mapOwnTracks([
      owntracksAndroidLocation,
      { _type: "location", lat: "north", lon: TEST_LON, tst: TST },
      { _type: "location", lat: TEST_LAT, lon: TEST_LON },
      "garbage",
      owntracksTransition,
      owntracksIosLocation,
    ]);
    expect(mapped.points).toHaveLength(2);
    expect(mapped).toMatchObject({ messages: 6, ignored: 1, invalid: 3 });
  });

  it("an encrypted payload is a message it cannot read: ignored, nothing stored", () => {
    expect(mapOwnTracks({ _type: "encrypted", data: "AAAA" })).toMatchObject({
      points: [],
      ignored: 1,
    });
  });
});
