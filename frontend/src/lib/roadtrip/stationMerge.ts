import { dayKey } from "./roadtripView";
import type { EditorStation } from "./editorStation";

/**
 * Three-way merge of a station list (forgejo#244): what the server confirmed
 * when the edits began (`base`), what the reader has now (`mine`), and what
 * the server holds now (`theirs` — the phone may have added a station, another
 * tab may have renamed one).
 *
 * A field only one side changed takes that side's value without asking. A
 * field BOTH changed, to different values, is a conflict the reader decides —
 * the issue's rule: before a draft goes over a newer server state, show the
 * conflict per field. Nothing is overwritten silently in either direction:
 *
 * - a station added on the server is kept (and named);
 * - a station removed on the server that the reader did not touch stays
 *   removed (and is named); one the reader DID change is a conflict;
 * - a station the reader removed that the server changed is a conflict too;
 * - the order is a conflict only when both sides moved stations differently.
 *
 * Every conflict starts on the server's side: the newer state wins unless the
 * reader says otherwise, so a reader who just presses "Übernehmen" loses no
 * one else's work.
 */

export const STATION_FIELDS = ["title", "place", "startDate", "endDate", "notes", "night"] as const;
export type StationField = (typeof STATION_FIELDS)[number];

export type MergeConflict =
  | {
      id: string;
      kind: "field";
      stationId: string;
      field: StationField;
      mine: EditorStation;
      theirs: EditorStation;
    }
  /** Changed on this device, removed on the server. */
  | { id: string; kind: "removedThere"; stationId: string; mine: EditorStation }
  /** Removed on this device, changed on the server. */
  | { id: string; kind: "removedHere"; stationId: string; theirs: EditorStation }
  /** Both sides moved stations, differently. */
  | { id: string; kind: "order" };

export type Choice = "mine" | "theirs";

export interface StationMerge {
  conflicts: MergeConflict[];
  /** Added on the server; kept whatever the reader chooses. */
  addedThere: EditorStation[];
  /** Removed on the server and untouched here; they stay removed. */
  removedThere: EditorStation[];
  /** The merged list, given a choice per conflict id (missing = "theirs"). */
  resolve: (choices?: Readonly<Record<string, Choice>>) => EditorStation[];
}

/** One comparable value per field, so "2026-07-14" and its ISO midnight agree. */
export function fieldValue(s: EditorStation, field: StationField): string {
  switch (field) {
    case "title":
      return s.title.trim();
    case "place":
      return s.lat === null || s.lon === null ? "" : `${s.lat},${s.lon}`;
    case "startDate":
      return dayKey(s.startDate ?? null) ?? "";
    case "endDate":
      return dayKey(s.endDate ?? null) ?? "";
    case "notes":
      return (s.notes ?? "").trim();
    case "night": {
      const n = s.night;
      if (n.kind === "stay") return `stay:${n.lodgingStayId ?? ""}`;
      if (n.kind === "pass") return `pass:${n.placeId ?? ""}`;
      return n.kind;
    }
  }
}

/** Copy one field (and what travels with it) from `from` onto `onto`. */
function takeField(onto: EditorStation, from: EditorStation, field: StationField): EditorStation {
  switch (field) {
    case "title":
      return { ...onto, title: from.title };
    case "place":
      return { ...onto, lat: from.lat, lon: from.lon };
    case "startDate":
      return { ...onto, startDate: from.startDate };
    case "endDate":
      return { ...onto, endDate: from.endDate };
    case "notes":
      return { ...onto, notes: from.notes };
    case "night":
      return {
        ...onto,
        night: from.night,
        stayLabel: from.stayLabel,
        stayCancelled: from.stayCancelled,
        stayLodgingId: from.stayLodgingId,
        stayPlace: from.stayPlace,
        placeLabel: from.placeLabel,
      };
  }
}

export function sameStation(a: EditorStation, b: EditorStation): boolean {
  return STATION_FIELDS.every((f) => fieldValue(a, f) === fieldValue(b, f));
}

/** True when the two lists say the same thing, in the same order. */
export function sameStationList(a: readonly EditorStation[], b: readonly EditorStation[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i].id && sameStation(s, b[i]));
}

const idOf = (s: EditorStation): string => s.id ?? `new:${s.key}`;

function relativeOrder(list: readonly EditorStation[], keep: ReadonlySet<string>): string[] {
  return list.map(idOf).filter((id) => keep.has(id));
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export function mergeStations(
  base: readonly EditorStation[],
  mine: readonly EditorStation[],
  theirs: readonly EditorStation[]
): StationMerge {
  const baseById = new Map(base.flatMap((s) => (s.id ? [[s.id, s] as const] : [])));
  const mineById = new Map(mine.flatMap((s) => (s.id ? [[s.id, s] as const] : [])));
  const theirsById = new Map(theirs.flatMap((s) => (s.id ? [[s.id, s] as const] : [])));

  const conflicts: MergeConflict[] = [];
  const addedThere: EditorStation[] = [];
  const removedThere: EditorStation[] = [];
  /** id → how the station comes out, given the choices. */
  const outcome = new Map<string, (c: Readonly<Record<string, Choice>>) => EditorStation | null>();

  for (const s of mine) {
    if (!s.id) {
      outcome.set(idOf(s), () => s);
      continue;
    }
    const b = baseById.get(s.id);
    const t = theirsById.get(s.id);
    if (!t) {
      if (b && sameStation(s, b)) {
        removedThere.push(b);
        outcome.set(s.id, () => null);
      } else {
        const id = `removedThere:${s.id}`;
        conflicts.push({ id, kind: "removedThere", stationId: s.id, mine: s });
        // Kept on this device's word: it goes back as a NEW station — the id
        // it had no longer exists on the server, which would refuse it.
        outcome.set(s.id, (c) => (c[id] === "mine" ? { ...s, id: undefined } : null));
      }
      continue;
    }
    // Without a base (a list that never saw it), this device's edits stand.
    const reference = b ?? t;
    const fieldConflicts = STATION_FIELDS.filter((f) => {
      const m = fieldValue(s, f);
      const th = fieldValue(t, f);
      return m !== th && m !== fieldValue(reference, f) && th !== fieldValue(reference, f);
    });
    for (const field of fieldConflicts) {
      conflicts.push({
        id: `field:${s.id}:${field}`,
        kind: "field",
        stationId: s.id,
        field,
        mine: s,
        theirs: t,
      });
    }
    outcome.set(s.id, (c) =>
      STATION_FIELDS.reduce<EditorStation>((acc, field) => {
        const m = fieldValue(s, field);
        const th = fieldValue(t, field);
        if (m === th) return acc;
        if (fieldConflicts.includes(field)) {
          return c[`field:${s.id}:${field}`] === "mine" ? acc : takeField(acc, t, field);
        }
        // Only the server moved this field off the base: take the server's.
        return m === fieldValue(reference, field) ? takeField(acc, t, field) : acc;
      }, s)
    );
  }

  for (const t of theirs) {
    if (!t.id || mineById.has(t.id)) continue;
    const b = baseById.get(t.id);
    if (!b) {
      addedThere.push(t);
      outcome.set(t.id, () => t);
    } else if (sameStation(t, b)) {
      // Removed here, untouched there: the removal stands.
      outcome.set(t.id, () => null);
    } else {
      const id = `removedHere:${t.id}`;
      conflicts.push({ id, kind: "removedHere", stationId: t.id, theirs: t });
      outcome.set(t.id, (c) => (c[id] === "mine" ? null : t));
    }
  }

  const everywhere = new Set(
    [...mineById.keys()].filter((id) => baseById.has(id) && theirsById.has(id))
  );
  const baseOrder = relativeOrder(base, everywhere);
  const mineOrder = relativeOrder(mine, everywhere);
  const theirsOrder = relativeOrder(theirs, everywhere);
  const mineMoved = !sameOrder(mineOrder, baseOrder);
  const theirsMoved = !sameOrder(theirsOrder, baseOrder);
  if (mineMoved && theirsMoved && !sameOrder(mineOrder, theirsOrder)) {
    conflicts.push({ id: "order", kind: "order" });
  }

  const resolve = (choices: Readonly<Record<string, Choice>> = {}): EditorStation[] => {
    const followMine =
      (mineMoved && !theirsMoved) || (mineMoved && theirsMoved && choices.order === "mine");
    const primary = followMine ? mine : theirs;
    const secondary = followMine ? theirs : mine;
    const sequence = primary.map(idOf).filter((id) => outcome.has(id));
    // Whatever the primary list does not hold goes in after its neighbour
    // in the list it came from — a station added on the phone between two
    // others lands between them.
    secondary.forEach((s, index) => {
      const id = idOf(s);
      if (!outcome.has(id) || sequence.includes(id)) return;
      let at = 0;
      for (let i = index - 1; i >= 0; i -= 1) {
        const before = sequence.indexOf(idOf(secondary[i]));
        if (before >= 0) {
          at = before + 1;
          break;
        }
      }
      sequence.splice(at, 0, id);
    });
    return sequence.flatMap((id) => {
      const station = outcome.get(id)?.(choices) ?? null;
      return station ? [station] : [];
    });
  };

  return { conflicts, addedThere, removedThere, resolve };
}
