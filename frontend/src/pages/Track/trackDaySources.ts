import type { TravTrackDay } from "../../lib/api/travtrack";
import type { DaySourceKind } from "../../lib/api/travtrackDaySources";
import type { LonLat } from "./map/trackGeometry";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A source in the user's words: what it is, and which one when there are several of a kind. */
export function sourceLabel(t: Translate, source: string, kind: DaySourceKind): string {
  const name = t(`track:daySources.kind.${kind}`);
  const ref = source.includes(":") ? source.slice(source.indexOf(":") + 1) : source;
  return ref ? `${name} · ${ref.slice(0, 8)}` : name;
}

/** What an origin is, as the server says it (`bestSource/choices.ts` `sourceKindOf`). */
export function kindOfOrigin(origin: string): DaySourceKind {
  const prefix = origin.split(":", 1)[0];
  if (["companion", "owntracks", "overland"].includes(prefix)) return "phone";
  if (prefix === "dawarich") return "dawarich";
  if (["gpx", "kml", "tcx", "fit", "geojson", "timeline", "import"].includes(prefix))
    return "import";
  return "other";
}

/** The kind of an origin the summary does not list (a choice the server made for an older read). */
export function kindOf(day: TravTrackDay, source: string): DaySourceKind {
  return day.sources?.sources.find((s) => s.source === source)?.kind ?? "other";
}

/** The day's dashed estimated chords and the entry lines over explained jumps, `[lon, lat]`. */
export function daySourceLines(days: readonly TravTrackDay[]): {
  estimated: LonLat[][];
  bridges: LonLat[][];
  /** Stretches matched to roads (rc46 extras C2), drawn over the track and labelled. */
  matched: LonLat[][];
} {
  return {
    estimated: days.flatMap((d) =>
      (d.estimated ?? []).map((g): LonLat[] => [
        [g.from[1], g.from[0]],
        [g.to[1], g.to[0]],
      ])
    ),
    bridges: days.flatMap((d) =>
      (d.bridgeLines ?? []).map((b) => b.coordinates.map((c): LonLat => [c[0], c[1]]))
    ),
    matched: days.flatMap((d) =>
      (d.cleanup?.matched ?? []).flatMap((m) =>
        m.lines.map((l) => l.map((c): LonLat => [c[0], c[1]]))
      )
    ),
  };
}
