/**
 * Request bodies of OwnTracks and Overland (TravTrack plan E9, Step 0).
 *
 * NOT YET RECORDED FROM REAL PHONES: these follow the apps' documented formats
 * (OwnTracks booklet "JSON" chapter, HTTP mode; Overland's README "API"
 * section), field for field, with every position replaced by the fixed test
 * coordinate below. Step 0 of the plan asks for captures from OwnTracks
 * (Android and iOS) and Overland (iOS) against the dev stack; when those exist
 * they replace these objects, and where they disagree the capture wins and the
 * mapping is amended.
 */

/** The fixed test coordinate: Seoul City Hall. */
export const TEST_LAT = 37.5665;
export const TEST_LON = 126.978;

/** 2026-10-20T08:00:00Z, in seconds. */
export const TST = 1_792_483_200;

/** An OwnTracks Android location message, HTTP mode. */
export const owntracksAndroidLocation = {
  _type: "location",
  _id: "5f1c2a9b",
  acc: 13,
  alt: 42,
  batt: 85,
  bs: 1,
  conn: "w",
  created_at: TST + 2,
  lat: TEST_LAT,
  lon: TEST_LON,
  m: 1,
  tid: "pp",
  tst: TST,
  vac: 3,
  vel: 18,
  cog: 270,
  t: "u",
  topic: "owntracks/user/pixel",
};

/** An OwnTracks iOS location message: no `cog` when not moving, `vel`/`cog` -1 when unknown. */
export const owntracksIosLocation = {
  _type: "location",
  acc: 5,
  alt: 38,
  batt: 64,
  bs: 2,
  conn: "m",
  created_at: TST + 61,
  lat: TEST_LAT + 0.001,
  lon: TEST_LON + 0.001,
  m: 2,
  tid: "ip",
  tst: TST + 60,
  vac: 4,
  vel: -1,
  cog: -1,
  topic: "owntracks/user/iphone",
  inregions: ["Zuhause"],
};

/** A region event: it carries a position, and still is not a location. */
export const owntracksTransition = {
  _type: "transition",
  wtst: TST - 86_400,
  lat: TEST_LAT,
  lon: TEST_LON,
  tst: TST + 120,
  acc: 10,
  tid: "pp",
  event: "enter",
  desc: "Zuhause",
  t: "c",
};

/** The last will: the app went away. */
export const owntracksLwt = { _type: "lwt", tst: TST + 180 };

/** One Overland feature as the app sends it. */
const overlandFeature = (minute: number, extra: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [TEST_LON + minute * 0.001, TEST_LAT] },
  properties: {
    timestamp: `2026-10-20T01:0${minute}:00-0700`,
    altitude: 12,
    speed: 4.2,
    horizontal_accuracy: 8,
    vertical_accuracy: 3,
    motion: ["walking"],
    pauses: false,
    activity: "fitness",
    desired_accuracy: 100,
    deferred: 0,
    significant_change: "disabled",
    locations_in_payload: 3,
    battery_state: "unplugged",
    battery_level: 0.71,
    device_id: "iphone",
    wifi: "",
    ...extra,
  },
});

/** An Overland batch of three points, with the app's `current` block. */
export const overlandBatch = {
  locations: [
    overlandFeature(0),
    overlandFeature(1, { motion: ["driving", "stationary"], course: 90 }),
    overlandFeature(2, { speed: -1, horizontal_accuracy: -1, motion: [] }),
  ],
  current: { type: "Feature", geometry: { type: "Point", coordinates: [TEST_LON, TEST_LAT] } },
};
