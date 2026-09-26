/**
 * The web's time module (ADR 0002). MIRRORED at backend/src/shared/time —
 * change both together; both run `backend/src/shared/time/vectors.json`.
 *
 * The one place in the web tree allowed to talk to zones: the ESLint rules in
 * scripts/eslint/timeRules.mjs exempt this directory and nothing else.
 */
export {
  ZoneUnknownError,
  deviceZone,
  formatOffset,
  isValidZone,
  localDay,
  toLocal,
  wallClockPartsOrNull,
  type InstantLike,
  type LocalReading,
  type WallClockParts,
} from "./zone";
export { now, setClockForTests, todayIn } from "./clock";
export {
  displayParts,
  formatTimeValue,
  type DisplayParts,
  type LocalDateValue,
  type LocalTimeInput,
  type TimePrecision,
  type TimeValue,
} from "./wire";
export { classifyWallClock, type WallClockKind } from "./wallClock";
