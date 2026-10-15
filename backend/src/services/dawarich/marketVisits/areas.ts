import { polygons, validateAreas, type MarketArea, type Polygon } from "./geometry";
export interface PreparedMarketArea extends MarketArea {
  areaIds: string[];
  sourceUrls: string[];
}
function polygonSize([outer, ...holes]: Polygon): number {
  const size = (ring: Polygon[number]) => {
    const [lon, lat] = ring[0];
    return Math.abs(
      ring
        .slice(1)
        .reduce(
          (n, p, i) => n + (ring[i][0] - lon) * (p[1] - lat) - (p[0] - lon) * (ring[i][1] - lat),
          0
        )
    );
  };
  return size(outer) - holes.reduce((n, h) => n + size(h), 0);
}
/** Same public entity ID or explicit parent only; proximity is never an identity. */
export function prepareMarketAreas(input: readonly MarketArea[]): PreparedMarketArea[] {
  validateAreas(input);
  const groups = new Map<string, MarketArea[]>();
  for (const area of input) {
    if (area.entityRef && !/^wikidata:Q[1-9][0-9]*$/.test(area.entityRef))
      throw new Error("Unsupported market entity reference");
    const key = area.entityRef ?? area.id;
    const group = groups.get(key) ?? [];
    group.push(area);
    groups.set(key, group);
  }
  const canonical = new Map<string, MarketArea>();
  for (const group of groups.values()) {
    const chosen = [...group].sort(
      (a, b) =>
        polygons(b).reduce((n, p) => n + polygonSize(p), 0) -
          polygons(a).reduce((n, p) => n + polygonSize(p), 0) || a.id.localeCompare(b.id)
    )[0];
    for (const area of group) canonical.set(area.id, chosen);
  }
  const rootOf = (area: MarketArea) => {
    let current = canonical.get(area.id)!;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(current.id)) throw new Error("Conflicting market hierarchy");
      seen.add(current.id);
      const members = [...groups.values()].find((g) => g.some((x) => x.id === current.id))!;
      const parents = [
        ...new Set(
          members
            .flatMap((a) => (a.parentId ? [canonical.get(a.parentId)!.id] : []))
            .filter((id) => id !== current.id)
        ),
      ];
      if (parents.length > 1) throw new Error("Conflicting parent markets");
      if (!parents.length) return current;
      current = canonical.get(parents[0])!;
    }
  };
  const grouped = new Map<string, { root: MarketArea; members: MarketArea[] }>();
  for (const area of input) {
    const root = rootOf(area);
    const group = grouped.get(root.id) ?? { root, members: [] };
    group.members.push(area);
    grouped.set(root.id, group);
  }
  return [...grouped.values()]
    .map(({ root, members }) => ({
      ...root,
      parentId: undefined,
      geometry: {
        type: "MultiPolygon" as const,
        coordinates: members.flatMap((area) => [...polygons(area)]),
      },
      areaIds: members.map((m) => m.id).sort(),
      sourceUrls: [...new Set(members.map((m) => m.sourceUrl))].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
