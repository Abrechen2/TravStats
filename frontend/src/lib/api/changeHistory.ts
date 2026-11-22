import { api } from "./client";

/** `/api/v1/change-history` — the change ledger (spec 2026-11-22-change-history). Bare. */

export type ChangeEntityType =
  | "flight"
  | "lodgingStay"
  | "rail"
  | "bus"
  | "ferry"
  | "rental"
  | "cruise"
  | "cruiseStop"
  | "trip"
  | "placeVisit"
  | "expense";

export type ChangeSource =
  "web" | "companion" | "api" | "import" | "auto_update" | "merge" | "share_sync" | "system";

export interface ChangeHistoryEntry {
  id: string;
  changeSetId: string;
  entityType: ChangeEntityType;
  entityId: string;
  operation: "update" | "delete";
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  valueType: string | null;
  omitted: boolean;
  label: string | null;
  source: ChangeSource;
  actor: "self" | "other" | null;
  reason: string | null;
  restoredFromId: string | null;
  restorable: boolean;
  createdAt: string;
}

export interface ChangeHistoryPage {
  entries: ChangeHistoryEntry[];
  nextCursor: string | null;
}

export const changeHistoryApi = {
  async forEntry(
    entityType: ChangeEntityType,
    entityId: string,
    after?: string
  ): Promise<ChangeHistoryPage> {
    const { data } = await api.get<ChangeHistoryPage>("/change-history", {
      params: { entityType, entityId, ...(after ? { after } : {}) },
    });
    return data;
  },

  async restore(id: string): Promise<ChangeHistoryEntry[]> {
    const { data } = await api.post<{ restored: ChangeHistoryEntry[] }>(
      `/change-history/${encodeURIComponent(id)}/restore`
    );
    return data.restored;
  },
};
