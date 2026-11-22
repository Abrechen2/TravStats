import { z } from "zod";

import { fetchOpenData, type OpenDataFailure } from "../openData/http";
import { isImo, isMmsi, normaliseVesselName } from "./vesselName";

/**
 * Wikidata as the vessel resolver's second source: P587 (MMSI) and P458 (IMO)
 * on a ship's item. Reached through the public API — a name search
 * (`wbsearchentities`), an IMO search (`haswbstatement:P458=…`) and the
 * entities' claims — never SPARQL, which times out under load and answers a
 * timeout with an empty table that reads like "no such ship".
 */

const API = "https://www.wikidata.org/w/api.php";
const SERVICE = "wikidata-vessel";

export interface WikidataVessel {
  qid: string;
  name: string;
  names: string[];
  mmsi: string | null;
  imo: string | null;
  operators: string[];
}

export type WikidataVesselResult =
  { ok: true; vessels: WikidataVessel[] } | { ok: false; failure: OpenDataFailure };

const searchSchema = z.object({
  search: z.array(z.object({ id: z.string() })).default([]),
});
const querySearchSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })).default([]) }),
});
const snakSchema = z.object({
  mainsnak: z.object({
    datavalue: z.object({ value: z.unknown() }).optional(),
  }),
  rank: z.string().optional(),
  qualifiers: z.record(z.string(), z.unknown()).optional(),
});
const entitySchema = z.object({
  labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
  aliases: z.record(z.string(), z.array(z.object({ value: z.string() }))).optional(),
  claims: z.record(z.string(), z.array(snakSchema)).optional(),
});
const entitiesSchema = z.object({ entities: z.record(z.string(), entitySchema) });

type Snak = z.infer<typeof snakSchema>;

const url = (params: Record<string, string>) =>
  `${API}?${new URLSearchParams({ format: "json", ...params }).toString()}`;

/**
 * The current value of a property: preferred-rank statements when there are
 * any, never deprecated ones, never one with an end time (P582) — a ship that
 * was re-flagged keeps its old MMSI on the item with an end date.
 */
export function currentValues(snaks: Snak[] | undefined): string[] {
  const live = (snaks ?? []).filter((s) => s.rank !== "deprecated" && !s.qualifiers?.P582);
  const preferred = live.filter((s) => s.rank === "preferred");
  const pick = preferred.length > 0 ? preferred : live;
  const values = pick
    .map((s) => s.mainsnak.datavalue?.value)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.replace(/\s+/g, ""));
  return [...new Set(values)];
}

function entityIdsOf(snaks: Snak[] | undefined): string[] {
  return currentValues(
    (snaks ?? []).map((s) => {
      const v = s.mainsnak.datavalue?.value as { id?: unknown } | undefined;
      return { ...s, mainsnak: { datavalue: { value: typeof v?.id === "string" ? v.id : null } } };
    })
  );
}

async function getEntities(
  ids: string[],
  props: string
): Promise<
  | { ok: true; entities: Record<string, z.infer<typeof entitySchema>> }
  | { ok: false; failure: OpenDataFailure }
> {
  if (ids.length === 0) return { ok: true, entities: {} };
  const answer = await fetchOpenData(
    SERVICE,
    url({ action: "wbgetentities", ids: ids.slice(0, 50).join("|"), props, languages: "en|de" })
  );
  if (!answer.ok) return { ok: false, failure: answer.failure };
  const parsed = entitiesSchema.safeParse(answer.body);
  if (!parsed.success) return { ok: false, failure: "unavailable" };
  return { ok: true, entities: parsed.data.entities };
}

/** Load ship items by Q-id with their names, current MMSI/IMO and operator names. */
async function loadVessels(qids: string[]): Promise<WikidataVesselResult> {
  const got = await getEntities(qids, "labels|aliases|claims");
  if (!got.ok) return got;
  const operatorIds = new Set<string>();
  const base = Object.entries(got.entities).map(([qid, e]) => {
    const ops = [...entityIdsOf(e.claims?.P137), ...entityIdsOf(e.claims?.P127)];
    ops.forEach((o) => operatorIds.add(o));
    const labels = Object.values(e.labels ?? {}).map((l) => l.value);
    const aliases = Object.values(e.aliases ?? {}).flatMap((list) => list.map((a) => a.value));
    const mmsis = currentValues(e.claims?.P587).filter(isMmsi);
    const imos = currentValues(e.claims?.P458).filter(isImo);
    return {
      qid,
      name: e.labels?.en?.value ?? e.labels?.de?.value ?? labels[0] ?? qid,
      names: [...new Set([...labels, ...aliases])],
      // Two current MMSIs on one item is itself ambiguous: abstain for this item.
      mmsi: mmsis.length === 1 ? mmsis[0] : null,
      imo: imos.length === 1 ? imos[0] : null,
      ops,
    };
  });
  const opLabels = await getEntities([...operatorIds], "labels");
  // Operator names only sharpen a match; their absence never fails the lookup.
  const opName = (id: string) =>
    opLabels.ok
      ? (opLabels.entities[id]?.labels?.en?.value ?? opLabels.entities[id]?.labels?.de?.value)
      : undefined;
  return {
    ok: true,
    vessels: base.map(({ ops, ...v }) => ({
      ...v,
      operators: ops.map(opName).filter((n): n is string => typeof n === "string"),
    })),
  };
}

/** Ship items whose label or alias starts with the name (Wikidata's own search). */
export async function searchWikidataByName(name: string): Promise<WikidataVesselResult> {
  const term = normaliseVesselName(name);
  if (term.length < 2) return { ok: true, vessels: [] };
  const answer = await fetchOpenData(
    SERVICE,
    url({ action: "wbsearchentities", search: term, language: "en", type: "item", limit: "20" })
  );
  if (!answer.ok) return { ok: false, failure: answer.failure };
  const parsed = searchSchema.safeParse(answer.body);
  if (!parsed.success) return { ok: false, failure: "unavailable" };
  const result = await loadVessels(parsed.data.search.map((s) => s.id));
  // Ships only — an item with an MMSI or an IMO. "Roald Amundsen" is also the
  // explorer; a ship without an MMSI still matters, as a second ship of the name.
  return result.ok
    ? { ok: true, vessels: result.vessels.filter((v) => v.mmsi !== null || v.imo !== null) }
    : result;
}

/** The ship items carrying this IMO number (P458). */
export async function searchWikidataByImo(imo: string): Promise<WikidataVesselResult> {
  if (!isImo(imo)) return { ok: true, vessels: [] };
  const answer = await fetchOpenData(
    SERVICE,
    url({ action: "query", list: "search", srsearch: `haswbstatement:P458=${imo}`, srlimit: "5" })
  );
  if (!answer.ok) return { ok: false, failure: answer.failure };
  const parsed = querySearchSchema.safeParse(answer.body);
  if (!parsed.success) return { ok: false, failure: "unavailable" };
  return loadVessels(parsed.data.query.search.map((s) => s.title).filter((t) => /^Q\d+$/.test(t)));
}
