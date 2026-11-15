import type { DomainBulkEditInput, ListEditMode } from "../../lib/api/domainBulkEdit";
import type { BulkRow } from "./useRowSelection";
import type { BulkField } from "../../shared/bulkEditFields";

/**
 * The bulk-edit draft and its preview (forgejo#405 A4). Pure, so the sentence a
 * user confirms and the request that is sent are built from one value. Mirrors
 * the server's rules (`services/bulkEdit/domainBulkEdit.ts`): a list "adds"
 * (union, keeps what a row has) or "replaces"; a trip and the text fields set
 * or clear; `status` cancels, or reinstates what is cancelled.
 */

export type TripEdit = { mode: "keep" } | { mode: "set"; tripId: string } | { mode: "clear" };
export type ListEdit = { mode: "keep" } | { mode: ListEditMode; values: string[] };
export type StatusEdit = { mode: "keep" | "cancel" | "reinstate" };
export type TextEditDraft = { mode: "keep" } | { mode: "set"; value: string } | { mode: "clear" };

export interface BulkEditDraft {
  trip: TripEdit;
  tags: ListEdit;
  companions: ListEdit;
  status: StatusEdit;
  operator: TextEditDraft;
  serviceClass: TextEditDraft;
}

export const emptyBulkEditDraft = (): BulkEditDraft => ({
  trip: { mode: "keep" },
  tags: { mode: "keep" },
  companions: { mode: "keep" },
  status: { mode: "keep" },
  operator: { mode: "keep" },
  serviceClass: { mode: "keep" },
});

export type Gap = "nothing" | BulkField;

const untouched = (draft: BulkEditDraft, fields: readonly BulkField[]): boolean =>
  fields.every((f) => draft[f].mode === "keep");

/** What is still missing before the draft can be sent; empty = ready. Only the domain's own fields count. */
export function bulkEditGaps(draft: BulkEditDraft, fields: readonly BulkField[]): Gap[] {
  const gaps: Gap[] = [];
  if (untouched(draft, fields)) gaps.push("nothing");
  if (draft.trip.mode === "set" && draft.trip.tripId === "") gaps.push("trip");
  // "Add nothing" is no edit. "Replace with nothing" is a real one: it clears.
  if (draft.tags.mode === "add" && draft.tags.values.length === 0) gaps.push("tags");
  if (draft.companions.mode === "add" && draft.companions.values.length === 0) {
    gaps.push("companions");
  }
  if (draft.operator.mode === "set" && draft.operator.value.trim() === "") gaps.push("operator");
  if (draft.serviceClass.mode === "set" && draft.serviceClass.value.trim() === "") {
    gaps.push("serviceClass");
  }
  return gaps;
}

export function bulkEditRequest(
  draft: BulkEditDraft,
  fields: readonly BulkField[],
  rows: readonly BulkRow[]
): DomainBulkEditInput {
  const input: DomainBulkEditInput = { ids: rows.map((r) => r.id) };
  const versions = Object.fromEntries(
    rows.flatMap((r) => (r.updatedAt ? [[r.id, r.updatedAt] as const] : []))
  );
  if (Object.keys(versions).length > 0) input.baseVersions = versions;
  if (fields.includes("trip") && draft.trip.mode === "set") {
    input.trip = { mode: "set", tripId: draft.trip.tripId };
  }
  if (fields.includes("trip") && draft.trip.mode === "clear") input.trip = { mode: "clear" };
  if (fields.includes("tags") && draft.tags.mode !== "keep") {
    input.tags = { mode: draft.tags.mode, values: draft.tags.values };
  }
  if (fields.includes("companions") && draft.companions.mode !== "keep") {
    input.companions = { mode: draft.companions.mode, values: draft.companions.values };
  }
  if (fields.includes("status") && draft.status.mode !== "keep") {
    input.status = { mode: draft.status.mode };
  }
  for (const key of ["operator", "serviceClass"] as const) {
    const edit = draft[key];
    if (!fields.includes(key) || edit.mode === "keep") continue;
    input[key] =
      edit.mode === "set" ? { mode: "set", value: edit.value.trim() } : { mode: "clear" };
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

export interface ListPreview {
  kind: ListEditMode;
  values: string[];
  change: number;
  already: number;
  lost: string[];
}

export interface BulkEditPreview {
  trip: { kind: "set"; gain: number; replace: number; already: number } | null;
  tripClear: { remove: number; none: number } | null;
  tags: ListPreview | null;
  companions: ListPreview | null;
  /** Rows that change; `already` are as asked. */
  status: { mode: "cancel" | "reinstate"; change: number; already: number } | null;
  operator: { mode: "set" | "clear"; value: string; change: number; already: number } | null;
  serviceClass: { mode: "set" | "clear"; value: string; change: number; already: number } | null;
}

function listPreview(
  edit: ListEdit,
  rows: readonly BulkRow[],
  read: (r: BulkRow) => string[]
): ListPreview | null {
  if (edit.mode === "keep") return null;
  let change = 0;
  const lost = new Set<string>();
  for (const r of rows) {
    const current = read(r);
    const next = edit.mode === "add" ? union(current, edit.values) : union([], edit.values);
    if (!same(current, next)) change += 1;
    if (edit.mode === "replace") for (const v of current) if (!next.includes(v)) lost.add(v);
  }
  return {
    kind: edit.mode,
    values: edit.values,
    change,
    already: rows.length - change,
    lost: [...lost],
  };
}

function textPreview(
  edit: TextEditDraft,
  rows: readonly BulkRow[],
  read: (r: BulkRow) => string | null | undefined
): BulkEditPreview["operator"] {
  if (edit.mode === "keep") return null;
  const target = edit.mode === "set" ? edit.value.trim() : null;
  const change = rows.filter((r) => (read(r) ?? null) !== target).length;
  return {
    mode: edit.mode,
    value: target ?? "",
    change,
    already: rows.length - change,
  };
}

export function bulkEditPreview(draft: BulkEditDraft, rows: readonly BulkRow[]): BulkEditPreview {
  let trip: BulkEditPreview["trip"] = null;
  let tripClear: BulkEditPreview["tripClear"] = null;
  if (draft.trip.mode === "set") {
    const target = draft.trip.tripId;
    trip = {
      kind: "set",
      gain: rows.filter((r) => !r.tripId).length,
      replace: rows.filter((r) => r.tripId && r.tripId !== target).length,
      already: rows.filter((r) => r.tripId === target).length,
    };
  } else if (draft.trip.mode === "clear") {
    const withTrip = rows.filter((r) => r.tripId).length;
    tripClear = { remove: withTrip, none: rows.length - withTrip };
  }
  let status: BulkEditPreview["status"] = null;
  if (draft.status.mode !== "keep") {
    const cancel = draft.status.mode === "cancel";
    const change = rows.filter((r) => (r.status === "cancelled") !== cancel).length;
    status = { mode: draft.status.mode, change, already: rows.length - change };
  }
  return {
    trip,
    tripClear,
    tags: listPreview(draft.tags, rows, (r) => r.tags ?? []),
    companions: listPreview(draft.companions, rows, (r) => r.companions ?? []),
    status,
    operator: textPreview(draft.operator, rows, (r) => r.operator),
    serviceClass: textPreview(draft.serviceClass, rows, (r) => r.serviceClass),
  };
}
