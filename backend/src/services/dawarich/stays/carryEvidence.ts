/**
 * What a re-derived stay finding keeps of the open findings it replaces: the answers the
 * plugins and the calendar gave about the stop, and the name it already had. A rescan rewrote
 * a grown finding's evidence as a whole and dropped every plugin answer on it; a merge of
 * fragments would have dropped them the same way. Better evidence still wins: the new row's
 * own name (an own place, a market) replaces the carried one, and a plugin's newer answer
 * replaces its older one the next time it is asked (`withPlugins`).
 */

type Carrier = { evidence: unknown; name?: string | null; placeId?: string | null };

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The carried keys of `rows`' evidence: plugin answers and owed plugins joined, a single value from the first row that has it. */
export function carriedEvidence(rows: readonly Carrier[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const plugins: Record<string, unknown>[] = [];
  const pending = new Set<string>();
  for (const row of rows) {
    const e = asRecord(row.evidence);
    if (Array.isArray(e.plugins)) {
      for (const p of e.plugins as Record<string, unknown>[]) {
        const same = plugins.findIndex((q) => q.pluginId === p.pluginId && q.name === p.name);
        if (same >= 0) plugins[same] = p;
        else plugins.push(p);
      }
    }
    if (Array.isArray(e.pluginsPending))
      for (const id of e.pluginsPending) if (typeof id === "string") pending.add(id);
    for (const key of ["suggestedPurpose", "suggestedPurposeFrom", "calendar"] as const)
      if (e[key] !== undefined && out[key] === undefined) out[key] = e[key];
  }
  if (plugins.length) out.plugins = plugins;
  if (pending.size) out.pluginsPending = [...pending];
  return out;
}

/** The name and place a replaced finding carried, for a new row that found none of its own. */
export function carriedName(rows: readonly Carrier[]): { name?: string; placeId?: string } {
  const named = rows.find((r) => r.name);
  if (!named) return {};
  return { name: named.name!, ...(named.placeId ? { placeId: named.placeId } : {}) };
}
