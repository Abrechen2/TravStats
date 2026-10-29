import { api } from "./client";

/** `/admin/aeroapi` (forgejo#409): the AeroAPI plan, this month's spending and the track switch. */
export type AeroapiTier = "personal" | "personal_feeder" | "custom";

export type AeroapiSweepStatus =
  | "disabled"
  | "no_key"
  | "nothing_to_do"
  | "done"
  | "stopped_budget"
  | "stopped_rate_limit"
  | "stopped_auth"
  | "already_running";

export interface AeroapiSettings {
  tier: AeroapiTier;
  customBudgetUsd: number | null;
  tracksEnabled: boolean;
  usage: {
    month: string;
    spentUsd: number;
    budgetUsd: number;
    calls: number;
    exhausted: boolean;
  };
  costUsd: { flights: number; track: number };
  lastTrackSweep: {
    at: string;
    status: AeroapiSweepStatus;
    counts: Partial<Record<"stored" | "has_track" | "no_match" | "no_track" | "error", number>>;
  } | null;
}

export interface AeroapiUpdate {
  tier?: AeroapiTier;
  customBudgetUsd?: number | null;
  tracksEnabled?: boolean;
}

export const aeroapiApi = {
  async get(): Promise<AeroapiSettings> {
    return (await api.get<AeroapiSettings>("/admin/aeroapi")).data;
  },
  async update(body: AeroapiUpdate): Promise<AeroapiSettings> {
    return (await api.put<AeroapiSettings>("/admin/aeroapi", body)).data;
  },
};
