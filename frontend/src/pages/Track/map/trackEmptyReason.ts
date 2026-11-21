import type { DayResult } from "./trackRange";

type Loaded = Extract<DayResult, { kind: "loaded" }>;

/**
 * Why nothing is drawn, from what the server counted (`TravTrackDay.omitted`). Never a guess:
 * a day without that answer (an older server) is `unknown`, and a failed day is not empty at
 * all (it has its own message and retry).
 */
export type EmptyReason =
  | { kind: "privacyZone"; count: number }
  | { kind: "implausible"; count: number }
  | { kind: "noRecording" }
  | { kind: "unknown" };

export function emptyReasons(loaded: readonly Loaded[], shownImplausible: boolean): EmptyReason[] {
  if (loaded.some((r) => r.day.omitted === undefined)) return [{ kind: "unknown" }];
  const sum = (key: "privacyZone" | "implausible") =>
    loaded.reduce((n, r) => n + (r.day.omitted?.[key] ?? 0), 0);
  const out: EmptyReason[] = [];
  if (sum("privacyZone") > 0) out.push({ kind: "privacyZone", count: sum("privacyZone") });
  // With the filtered fixes already asked for, they are no reason for an empty map any more.
  if (!shownImplausible && sum("implausible") > 0)
    out.push({ kind: "implausible", count: sum("implausible") });
  return out.length > 0 ? out : [{ kind: "noRecording" }];
}
