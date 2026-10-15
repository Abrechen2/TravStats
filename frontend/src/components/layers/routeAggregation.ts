/** Full geometry, not just endpoints: two ways between the same stops stay distinct.
 * Sub-millimetre rounding removes floating-point noise in reversed great circles.
 */
export function pathIdentity(path: readonly (readonly number[])[], directed = false): string {
  const points = path.map((point) => point.map((n) => Number(n.toFixed(9))).join(","));
  const forward = points.join(";");
  if (directed) return forward;
  const reverse = [...points].reverse().join(";");
  return forward < reverse ? forward : reverse;
}

export type RouteGroup<T> = T & { memberIds: string[]; count: number };

/** Only map data is grouped. Source journeys and their statistics remain untouched. */
export function groupMapData<T extends { label?: string; memberIds?: string[]; count?: number }>(
  data: readonly T[],
  keyOf: (item: T) => string,
  idOf: (item: T) => string
): RouteGroup<T>[] {
  const groups = new Map<string, RouteGroup<T>>();
  const labels = new Map<string, Set<string>>();
  const memberSets = new Map<string, Set<string>>();
  for (const item of data) {
    const key = keyOf(item);
    const members = item.memberIds ?? [idOf(item)];
    const existing = groups.get(key);
    if (existing) {
      existing.count += item.count ?? 1;
      const known = memberSets.get(key)!;
      for (const id of members)
        if (!known.has(id)) {
          known.add(id);
          existing.memberIds.push(id);
        }
    } else {
      memberSets.set(key, new Set(members));
      groups.set(key, { ...item, memberIds: [...new Set(members)], count: item.count ?? 1 });
    }
    if (item.label) {
      const names = labels.get(key) ?? new Set<string>();
      names.add(item.label);
      labels.set(key, names);
    }
  }
  for (const [key, group] of groups) {
    const names = labels.get(key);
    if (names) group.label = [...names].join(" / ") + (group.count > 1 ? ` × ${group.count}` : "");
  }
  return [...groups.values()];
}
