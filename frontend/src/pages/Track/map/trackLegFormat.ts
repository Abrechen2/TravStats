import type { TravTrackLeg } from "../../../lib/api/travtrackLegs";

/**
 * How a leg's figures are worded (spec 2026-11-03-travtrack-legs, W1). A figure
 * the server could not derive is `null` and reads "–" — never 0.
 */

export const DASH = "–";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const makeNumber = (language: string) => (value: number, digits: number) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

/** "1 h 05 min" / "12 min"; a stretch shorter than a minute is "< 1 min". */
export function durationText(ms: number, t: Translate): string {
  if (ms > 0 && ms < 60_000) return t("track:legs.underMinute");
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60
    ? t("track:map.totals.hours", { h: Math.floor(minutes / 60), m: minutes % 60 })
    : t("track:map.totals.minutes", { m: minutes });
}

export interface LegFigure {
  key: "distance" | "duration" | "moving" | "avgSpeed" | "maxSpeed" | "ascent" | "descent";
  value: string;
}

/** The leg card's figures in order; null is a dash. */
export function legFigures(
  leg: TravTrackLeg,
  t: Translate,
  number: (value: number, digits: number) => string
): LegFigure[] {
  const kmh = (mps: number | null) =>
    mps === null ? DASH : t("track:map.totals.kmh", { kmh: number(mps * 3.6, 0) });
  const metres = (m: number | null) =>
    m === null ? DASH : t("track:legs.metres", { m: number(m, 0) });
  return [
    { key: "distance", value: t("track:map.totals.km", { km: number(leg.distanceM / 1000, 1) }) },
    { key: "duration", value: durationText(leg.durationMs, t) },
    { key: "moving", value: leg.movingMs === null ? DASH : durationText(leg.movingMs, t) },
    { key: "avgSpeed", value: kmh(leg.avgSpeedMps) },
    { key: "maxSpeed", value: kmh(leg.maxSpeedMps) },
    { key: "ascent", value: metres(leg.ascentM) },
    { key: "descent", value: metres(leg.descentM) },
  ];
}

/** The mode's name; an auto mode the evidence only half supports says so. */
export function legModeLabel(leg: TravTrackLeg, t: Translate): string {
  const name = t(`track:legs.mode.${leg.mode}`);
  return leg.modeSource === "auto" && leg.confidence === "low"
    ? t("track:legs.uncertain", { mode: name })
    : name;
}
