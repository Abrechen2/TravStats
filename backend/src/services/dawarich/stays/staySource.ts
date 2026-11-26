import { prisma } from "../../../db";
import { matchesOf } from "../../places/brandRules";

/**
 * Where a stay suggestion came from (owner 2026-11-26: "filter the inbox by source"). A finding
 * can carry several — a smart list's match, a plugin's answer and a calendar event on the same
 * stop — so the row names all of them (`sources`) and the most specific first (`source`):
 * a smart list, then a plugin, then the calendar, then the location provider itself.
 */
export type StaySourceKind = "smartList" | "plugin" | "calendar" | "travtrack" | "dawarich";
export interface StaySource {
  kind: StaySourceKind;
  /** The list's or plugin's id; null for the calendar and the providers. */
  id: string | null;
  /** The list's or plugin's name, read live; null where the kind names it. */
  name: string | null;
}

type Evidence = {
  calendar?: unknown;
  plugins?: { pluginId?: unknown; pluginName?: unknown }[];
} | null;

/** The sources of one finding, most specific first; names come from `names` (live) when known. */
export function staySourcesOf(
  row: { provider: string; evidence: unknown },
  names: { lists: Map<string, string>; plugins: Map<string, string> }
): StaySource[] {
  const out: StaySource[] = [];
  const seen = new Set<string>();
  const add = (s: StaySource) => {
    const key = `${s.kind}:${s.id ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const m of matchesOf(row.evidence)) {
    // A list deleted since the match is no source any more.
    if (typeof m.listId !== "string" || !names.lists.has(m.listId)) continue;
    add({ kind: "smartList", id: m.listId, name: names.lists.get(m.listId)! });
  }
  const evidence = row.evidence as Evidence;
  for (const p of Array.isArray(evidence?.plugins) ? evidence.plugins : []) {
    if (!p || typeof p !== "object" || typeof p.pluginId !== "string") continue;
    const stored = typeof p.pluginName === "string" ? p.pluginName : null;
    add({ kind: "plugin", id: p.pluginId, name: names.plugins.get(p.pluginId) ?? stored });
  }
  if (evidence?.calendar) add({ kind: "calendar", id: null, name: null });
  add({ kind: row.provider === "travtrack" ? "travtrack" : "dawarich", id: null, name: null });
  return out;
}

/** The live names of the account's lists and plugins, for `staySourcesOf`. */
export async function sourceNames(userId: string) {
  const [lists, plugins] = await Promise.all([
    prisma.placeList.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.suggestionPlugin.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  return {
    lists: new Map(lists.map((l) => [l.id, l.name])),
    plugins: new Map(plugins.map((p) => [p.id, p.name])),
  };
}

/** `?source=`: a kind (`calendar`, `plugin`, …) or a kind with its id (`smartList:<uuid>`). */
export function matchesSource(sources: readonly StaySource[], filter: string): boolean {
  const [kind, id] = filter.split(":", 2);
  return sources.some((s) => s.kind === kind && (id === undefined || s.id === id));
}

export const SOURCE_FILTER = /^(smartList|plugin|calendar|travtrack|dawarich)(:[0-9a-f-]{36})?$/;
