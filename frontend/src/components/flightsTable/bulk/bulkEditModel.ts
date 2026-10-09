import type { Flight, Trip } from "../../../types";
import type { FlightBulkEditInput, ListEditMode } from "../../../lib/api/flightBulkEdit";

/**
 * The bulk-edit draft and its preview (forgejo#217). Pure, so the sentence a
 * user confirms and the request that is sent are built from one value.
 *
 * The preview counts per field what will happen to the SELECTED flights as
 * the page holds them: which gain a value, which have one replaced, which
 * stay as they are. It mirrors the server's rules (`services/flights/
 * bulkEdit.ts`): "add" is a union that keeps what a flight has, "replace"
 * swaps the whole list, a trip is set or cleared. Companion names are compared
 * as typed; the server folds case ("Anna" and "anna" are one person), so the
 * preview may count a case-only difference as a change the server then
 * answers as `unchanged` — the result list says so per flight.
 */

export type TripEdit = { mode: "keep" } | { mode: "set"; tripId: string } | { mode: "clear" };
export type ListEdit = { mode: "keep" } | { mode: ListEditMode; values: string[] };

export interface BulkEditDraft {
  trip: TripEdit;
  tags: ListEdit;
  companions: ListEdit;
}

export const emptyBulkEditDraft = (): BulkEditDraft => ({
  trip: { mode: "keep" },
  tags: { mode: "keep" },
  companions: { mode: "keep" },
});

type Selected = Pick<Flight, "id" | "tripId" | "tags" | "companions">;

/** What is still missing before the draft can be sent, as field names; empty = ready. */
export function bulkEditGaps(
  draft: BulkEditDraft
): Array<"nothing" | "trip" | "tags" | "companions"> {
  const gaps: Array<"nothing" | "trip" | "tags" | "companions"> = [];
  if (
    draft.trip.mode === "keep" &&
    draft.tags.mode === "keep" &&
    draft.companions.mode === "keep"
  ) {
    gaps.push("nothing");
  }
  if (draft.trip.mode === "set" && draft.trip.tripId === "") gaps.push("trip");
  // "Add nothing" is no edit. "Replace with nothing" is a real one: it clears.
  if (draft.tags.mode === "add" && draft.tags.values.length === 0) gaps.push("tags");
  if (draft.companions.mode === "add" && draft.companions.values.length === 0) {
    gaps.push("companions");
  }
  return gaps;
}

export function bulkEditRequest(draft: BulkEditDraft, flightIds: string[]): FlightBulkEditInput {
  const input: FlightBulkEditInput = { flightIds };
  if (draft.trip.mode === "set") input.trip = { mode: "set", tripId: draft.trip.tripId };
  if (draft.trip.mode === "clear") input.trip = { mode: "clear" };
  if (draft.tags.mode !== "keep") input.tags = { mode: draft.tags.mode, values: draft.tags.values };
  if (draft.companions.mode !== "keep") {
    input.companions = { mode: draft.companions.mode, values: draft.companions.values };
  }
  return input;
}

const union = (current: readonly string[], added: readonly string[]): string[] => {
  const out = [...current];
  for (const v of added) if (!out.includes(v)) out.push(v);
  return out;
};
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export type TripPreview =
  | { kind: "set"; tripName: string; gain: number; replace: number; already: number }
  | { kind: "clear"; remove: number; none: number };

export interface ListPreview {
  kind: ListEditMode;
  values: string[];
  /** Flights whose list will change. */
  change: number;
  /** Flights already as asked. */
  already: number;
  /** For `replace`: values some selected flight has today that it will lose. */
  lost: string[];
}

export interface BulkEditPreview {
  trip: TripPreview | null;
  tags: ListPreview | null;
  companions: ListPreview | null;
}

function listPreview(
  edit: ListEdit,
  flights: readonly Selected[],
  read: (f: Selected) => string[]
): ListPreview | null {
  if (edit.mode === "keep") return null;
  let change = 0;
  const lost = new Set<string>();
  for (const f of flights) {
    const current = read(f);
    const next = edit.mode === "add" ? union(current, edit.values) : union([], edit.values);
    if (!same(current, next)) change += 1;
    if (edit.mode === "replace") for (const v of current) if (!next.includes(v)) lost.add(v);
  }
  return {
    kind: edit.mode,
    values: edit.values,
    change,
    already: flights.length - change,
    lost: [...lost],
  };
}

export function bulkEditPreview(
  draft: BulkEditDraft,
  flights: readonly Selected[],
  trips: readonly Pick<Trip, "id" | "name">[]
): BulkEditPreview {
  let trip: TripPreview | null = null;
  if (draft.trip.mode === "set") {
    const target = draft.trip.tripId;
    trip = {
      kind: "set",
      tripName: trips.find((t) => t.id === target)?.name ?? "",
      gain: flights.filter((f) => !f.tripId).length,
      replace: flights.filter((f) => f.tripId && f.tripId !== target).length,
      already: flights.filter((f) => f.tripId === target).length,
    };
  } else if (draft.trip.mode === "clear") {
    const withTrip = flights.filter((f) => f.tripId).length;
    trip = { kind: "clear", remove: withTrip, none: flights.length - withTrip };
  }
  return {
    trip,
    tags: listPreview(draft.tags, flights, (f) => f.tags ?? []),
    companions: listPreview(draft.companions, flights, (f) => f.companions ?? []),
  };
}
