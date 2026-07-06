// Priority-based label reveal for the flat map.
//
// The old behaviour hid ALL marker labels below a hard zoom threshold, so
// zooming out wiped even the big, frequently-visited airports/ports. Instead
// we keep a zoom-dependent BUDGET of labels and always spend it on the
// highest-weight markers (visit count / size). Zooming in grows the budget so
// smaller markers reveal progressively; zooming out keeps only the important
// ones — which are spread far apart at world scale, so they don't collide.

export type LabelsMode = "off" | "important" | "all";

// How many labels may show at a given (rounded) zoom in "important" mode.
// Tuned so a world view shows a handful of hubs and each zoom step roughly
// doubles the count until effectively everything is labelled.
export function labelBudget(zoom: number): number {
  const z = Number.isFinite(zoom) ? zoom : 0;
  if (z <= 1) return 5;
  return Math.round(5 * Math.pow(1.9, Math.max(0, z - 1)));
}

// Return the subset of `items` that should be labelled for the given mode +
// zoom, highest-weight first. "all" labels everything, "off" labels nothing,
// "important" spends the zoom budget on the heaviest markers.
export function pickLabelled<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  mode: LabelsMode,
  zoom: number
): T[] {
  if (mode === "off") return [];
  if (mode === "all") return [...items];
  const budget = labelBudget(zoom);
  if (items.length <= budget) return [...items];
  return [...items].sort((a, b) => weightOf(b) - weightOf(a)).slice(0, budget);
}
