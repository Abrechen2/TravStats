import { api } from "./client";

/** Inbox kinds the bulk endpoint answers; plugin archive proposals are never among them. */
export type BulkKind = "review" | "trips" | "updates" | "photos" | "dawarich" | "location";
export interface BulkResult {
  kind: BulkKind;
  id: string;
  outcome: "done" | "skipped" | "failed";
  reason?: string;
  undoable?: true;
}

/** One request, each item answered on its own through its kind's accept or reject. */
export async function answerInBulk(
  action: "accept" | "reject",
  items: { kind: BulkKind; id: string }[]
): Promise<BulkResult[]> {
  const { data } = await api.post<{ success: true; data: { results: BulkResult[] } }>(
    "/inbox/bulk",
    { action, items },
    { timeout: 120_000 }
  );
  return data.data.results;
}
