import type { DeepLinkTarget } from "../photoSource/deepLink";
import type { EntryPlan } from "./entryKinds";

/**
 * What "In Immich/PhotoPrism öffnen" narrows to for an entry: the span of its
 * windows, and — when every leg is at the same single point — that place. A
 * corridor or a two-airport flight has no one place, so only the dates carry.
 */
export function choiceTarget(plan: Exclude<EntryPlan, "untimed">): DeepLinkTarget {
  const starts = plan.legs.map((l) => l.window.start.getTime());
  const ends = plan.legs.map((l) => l.window.end.getTime());
  const window = { start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) };
  const places = plan.legs.flatMap((l) => l.locations);
  const first = places[0];
  const sameSingle =
    first?.kind === "point" &&
    places.every((l) => l.kind === "point" && l.lat === first.lat && l.lon === first.lon);
  return sameSingle
    ? { window, point: { lat: first.lat, lon: first.lon, radiusKm: first.radiusKm } }
    : { window };
}
