/**
 * How much a recording of each kind of travel may wander before it is jitter
 * (forgejo#319). Read by `jitterFilter.ts`; one table so every source — the
 * flight recorder, a tour's GPX, a cruise's Dawarich pull, the trip recording
 * — answers the same question with the same numbers.
 *
 * The four knobs and why each mode sets them as it does:
 *
 * - `maxSpeedKmh` — the fastest a fix may imply. Only an OUT-AND-BACK fix is
 *   ever dropped for it (a spike that returns within a few fixes), so a mode
 *   that was guessed wrong cannot eat a sustained ride: a car drive in a
 *   "foot" recording moves away and never comes back to where it was, and
 *   every one of its fixes is kept. Each value sits above the mode's real
 *   ceiling: 1300 km/h is a jet's ground speed in a strong jet stream, 90 km/h
 *   a fast catamaran ferry (~40 kn), 400 km/h a high-speed train, 250 km/h a
 *   car, 100 km/h a bicycle downhill, 50 km/h twice a sprinter.
 * - `floorRadiusM` — how far a fix may sit from the point it is standing at
 *   and still be the same place, when the phone reports no accuracy or an
 *   accuracy better than it can really hold indoors. It is the radius a stay
 *   is gathered in, and the slack a speed check allows on each end.
 * - `minStayMs` — how long fixes must stay in one place before they are a
 *   stay and collapse to one place, and the shortest window a stay is judged
 *   over (`stayDetection.ts`). This is the guard for slow movement: over a
 *   window W the two half-windows of a phone moving at v lie v · W / 2 apart,
 *   so nothing faster than 2 · radius / W is ever called a stay. Per mode:
 *   flight 2·100 m / 180 s = 4 km/h (a plane taxiing at 15 km/h, or crawling
 *   to the holding point at 5, is kept); ground 2·30 m / 120 s = 1.8 km/h (a
 *   car in a jam at 5 km/h is kept); foot and bike 2·20 m / 120 s = 1.2 km/h
 *   (a hike uphill at 2 km/h is kept); ship 2·50 m / 180 s = 2 km/h (a ship
 *   manoeuvring in port at 3 kn is kept). Pacing to and fro inside the radius
 *   — a deck walk on a moored ship — goes nowhere at map scale and is a stay.
 * - `maxAccuracyM` — the reported accuracy above which a fix is a coarse
 *   network position rather than a satellite one. A phone's satellite or
 *   Wi-Fi fixes report well under 100 m; a cell-tower fix reports 500 m to a
 *   few kilometres. 300 m separates the two classes in every mode.
 */

export const JITTER_MODES = ["flight", "ship", "road", "rail", "foot", "bike", "mixed"] as const;
export type JitterMode = (typeof JITTER_MODES)[number];

export interface JitterProfile {
  maxSpeedKmh: number;
  floorRadiusM: number;
  minStayMs: number;
  maxAccuracyM: number;
}

const MINUTE_MS = 60_000;
const COARSE_FIX_M = 300;

export const JITTER_PROFILES: Readonly<Record<JitterMode, JitterProfile>> = {
  // A phone in a cabin at the gate wanders tens to hundreds of metres
  // (forgejo#319) — hence the widest floor of all modes, affordable because
  // an aircraft on the ground is never slower than a walk for three minutes
  // without standing still.
  flight: {
    maxSpeedKmh: 1300,
    floorRadiusM: 100,
    minStayMs: 3 * MINUTE_MS,
    maxAccuracyM: COARSE_FIX_M,
  },
  ship: { maxSpeedKmh: 90, floorRadiusM: 50, minStayMs: 3 * MINUTE_MS, maxAccuracyM: COARSE_FIX_M },
  road: {
    maxSpeedKmh: 250,
    floorRadiusM: 30,
    minStayMs: 2 * MINUTE_MS,
    maxAccuracyM: COARSE_FIX_M,
  },
  rail: {
    maxSpeedKmh: 400,
    floorRadiusM: 30,
    minStayMs: 2 * MINUTE_MS,
    maxAccuracyM: COARSE_FIX_M,
  },
  foot: { maxSpeedKmh: 50, floorRadiusM: 20, minStayMs: 2 * MINUTE_MS, maxAccuracyM: COARSE_FIX_M },
  bike: {
    maxSpeedKmh: 100,
    floorRadiusM: 20,
    minStayMs: 2 * MINUTE_MS,
    maxAccuracyM: COARSE_FIX_M,
  },
  // A whole trip recorded in the background: walks, cars, trains and ferries
  // in one stream. Flights are cut out before it is stored, so the ceiling is
  // the fastest train.
  mixed: {
    maxSpeedKmh: 400,
    floorRadiusM: 30,
    minStayMs: 2 * MINUTE_MS,
    maxAccuracyM: COARSE_FIX_M,
  },
};

/**
 * The mode a tour or roadtrip recording is filtered as. The activity is the
 * more specific word (a "hike" section may carry the default mode `road`);
 * the section's leg mode decides otherwise. Anything unknown is `mixed`, the
 * profile that assumes least.
 */
export function tourJitterMode(route: {
  mode?: string | null;
  activity?: string | null;
}): JitterMode {
  switch (route.activity) {
    case "hike":
    case "walk":
    case "run":
    case "climb":
    case "paddle":
      return "foot";
    case "bike":
    case "mtb":
      return "bike";
    case "ski":
    case "excursion":
      return "road";
    default:
      break;
  }
  switch (route.mode) {
    case "road":
      return "road";
    case "ferry":
      return "ship";
    case "rail":
      return "rail";
    case "foot":
      return "foot";
    case "bike":
      return "bike";
    default:
      return "mixed";
  }
}
