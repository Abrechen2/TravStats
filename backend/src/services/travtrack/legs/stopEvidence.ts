/**
 * Where a stop's name came from and how sure the pipeline is — read from the
 * evidence the stop's stay finding already carries (`visit` from the venue
 * lookup, `calendar`, `plugins[]`), never invented: a stop whose finding holds
 * no evidence gets no view, and a view with nothing to weigh gets no
 * confidence (so the client shows no meter).
 */

export type EvidenceReason =
  | { code: "venue"; distanceM: number }
  | { code: "dwell"; minutes: number }
  | { code: "calendar"; title: string }
  | { code: "plugin"; pluginName: string; name: string; distanceM: number | null };

export type StopEvidenceView = {
  source:
    | { kind: "plugin"; pluginName: string; name: string; note: string | null }
    | { kind: "calendar"; title: string }
    | { kind: "venue" };
  confidence: { level: "high" | "medium" | "low"; reasons: EvidenceReason[] } | null;
};

/** Points: enough of them is "high"; the thresholds are the ones in `stopEvidence.test.ts`. */
export const HIGH_POINTS = 4;
export const MEDIUM_POINTS = 2;
const NEAR_VENUE_M = 50;
const CLOSE_VENUE_M = 150;
const NEAR_PLUGIN_M = 150;
const FAR_PLUGIN_M = 1000;
const LONG_DWELL_MIN = 30;

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function stopEvidenceView(evidence: unknown): StopEvidenceView | null {
  const e = obj(evidence);
  if (!e) return null;
  const visit = obj(e.visit);
  const venueName = str(obj(visit?.venue)?.name);
  const venueDistance = num(visit?.distanceM);
  const dwellMin =
    num(visit?.durationMs) !== null ? Math.round(num(visit?.durationMs)! / 60_000) : null;
  const calendar = obj(e.calendar);
  const calendarTitle = str(calendar?.title);
  const plugins = (Array.isArray(e.plugins) ? e.plugins : []).flatMap((p) => {
    const o = obj(p);
    const name = str(o?.name);
    const pluginName = str(o?.pluginName);
    return o && name && pluginName
      ? [
          {
            pluginName,
            name,
            note: str(o.note),
            distanceM: num(o.distanceM),
            confidence: num(o.confidence),
          },
        ]
      : [];
  });
  // The nearest answer is the one that names the stop.
  const plugin = [...plugins].sort(
    (a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity)
  )[0];

  const source: StopEvidenceView["source"] | null = plugin
    ? { kind: "plugin", pluginName: plugin.pluginName, name: plugin.name, note: plugin.note }
    : calendarTitle
      ? { kind: "calendar", title: calendarTitle }
      : venueName
        ? { kind: "venue" }
        : null;
  if (!source) return null;

  const reasons: EvidenceReason[] = [];
  let points = 0;
  if (plugin && plugin.distanceM !== null && plugin.distanceM <= FAR_PLUGIN_M) {
    // A plugin that doubts its own answer (confidence under one half) counts one point less.
    const base = plugin.distanceM <= NEAR_PLUGIN_M ? 2 : 1;
    points += plugin.confidence !== null && plugin.confidence < 0.5 ? base - 1 : base;
    reasons.push({
      code: "plugin",
      pluginName: plugin.pluginName,
      name: plugin.name,
      distanceM: plugin.distanceM,
    });
  }
  if (calendarTitle) {
    // A calendar event that only fits the day's context (not a place or a time overlap) is weaker.
    points += calendar?.match === "context" ? 1 : 2;
    reasons.push({ code: "calendar", title: calendarTitle });
  }
  if (venueName && venueDistance !== null) {
    points += venueDistance <= NEAR_VENUE_M ? 2 : venueDistance <= CLOSE_VENUE_M ? 1 : 0;
    reasons.push({ code: "venue", distanceM: Math.round(venueDistance) });
  }
  // Nothing measurable besides the time spent: no level rather than one made from a dwell alone.
  if (reasons.length === 0) return { source, confidence: null };
  if (dwellMin !== null && dwellMin >= LONG_DWELL_MIN) {
    points += 1;
    reasons.push({ code: "dwell", minutes: dwellMin });
  }
  const level = points >= HIGH_POINTS ? "high" : points >= MEDIUM_POINTS ? "medium" : "low";
  return { source, confidence: { level, reasons } };
}
