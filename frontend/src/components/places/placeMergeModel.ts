import type { Place } from "../../types/place";
import type { PlaceMergeInput } from "../../lib/api/places";

/**
 * The master-data groups a merge asks about (forgejo#232), in the order the
 * comparison shows them. Mirrors `mergePlaceSchema` in
 * `backend/src/schemas/place.ts` — the address is ONE group (street, city,
 * country), so a merge cannot assemble an address neither place had.
 */
export const MERGE_GROUPS = [
  "name",
  "localName",
  "category",
  "position",
  "address",
  "notes",
] as const;
export type MergeGroup = (typeof MERGE_GROUPS)[number];

/** Which place a group's value comes from; notes may keep both. */
export type MergeChoice = "target" | "source" | "both";
export type MergeChoices = Partial<Record<MergeGroup, MergeChoice>>;

/** A comparable reading of one group — two places agree when these match. */
export function groupKey(place: Place, group: MergeGroup): string {
  switch (group) {
    case "name":
      return place.name.trim();
    case "localName":
      return (place.localName ?? "").trim();
    case "category":
      return place.category;
    // Five decimals is about a metre: two pins that close are the same pin.
    case "position":
      return `${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
    case "address":
      return [place.address, place.city, place.country].map((v) => (v ?? "").trim()).join("|");
    case "notes":
      return (place.notes ?? "").trim();
  }
}

export function sameGroup(target: Place, source: Place, group: MergeGroup): boolean {
  return groupKey(target, group) === groupKey(source, group);
}

/** The groups that differ and have no answer yet — what keeps "Zusammenführen" greyed out. */
export function openGroups(target: Place, source: Place, choices: MergeChoices): MergeGroup[] {
  return MERGE_GROUPS.filter((g) => !sameGroup(target, source, g) && choices[g] === undefined);
}

/**
 * The request's `fields`. A group both places agree on needs no answer and is
 * sent as "target" — the value is the same either way. Null while any
 * differing group is still open: the user picks, the form never guesses.
 */
export function mergeFields(
  target: Place,
  source: Place,
  choices: MergeChoices
): PlaceMergeInput["fields"] | null {
  if (openGroups(target, source, choices).length > 0) return null;
  const side = (g: MergeGroup): "target" | "source" =>
    !sameGroup(target, source, g) && choices[g] === "source" ? "source" : "target";
  const notes = sameGroup(target, source, "notes") ? "target" : (choices.notes ?? "target");
  return {
    name: side("name"),
    localName: side("localName"),
    category: side("category"),
    position: side("position"),
    address: side("address"),
    // "both" exists for the notes alone: two notes can be joined, two names not.
    notes,
  };
}
