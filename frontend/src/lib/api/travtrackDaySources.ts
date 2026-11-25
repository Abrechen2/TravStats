import { api } from "./client";

/**
 * Best source per day (server `services/travtrack/bestSource/`): which source
 * a day is drawn and counted from, the user's choice, the questionable days
 * and the preview of a range delete. Raw points are never changed by any of it.
 */

export type DaySourceKind = "phone" | "dawarich" | "import" | "other";
export type TravelKind = "flight" | "rail" | "bus" | "ferry";
export type OutlierDecision = "discard" | "keep";

export interface DaySourceBridge {
  fromMs: number;
  untilMs: number;
  kind: TravelKind;
  entryId: string;
  reason: "jump" | "gap";
}

export interface DaySourceSummary {
  /** false: the server has not resolved the day yet. */
  scored: boolean;
  sources: Array<{
    source: string;
    kind: DaySourceKind;
    score: number;
    points: number;
    accuracyKnownShare: number;
  }>;
  segments: Array<{ fromMs: number; untilMs: number; source: string }>;
  override: string | null;
  mixed: boolean;
  bestScore: number | null;
  outliers: { count: number; decision: OutlierDecision | null };
  bridges: DaySourceBridge[];
  breaks: Array<[number, number]>;
  clockOffset: { source: string; relativeTo: string; offsetS: number } | null;
  truncated: boolean;
  questionable: boolean;
}

/** A long silence drawn dashed as estimated; `[lat, lon]` ends. */
export interface EstimatedGap {
  fromMs: number;
  untilMs: number;
  from: [number, number];
  to: [number, number];
}

/** A jump or gap a logged entry explains, drawn with its line (`[lon, lat]`). */
export type BridgeLine = DaySourceBridge & { coordinates: number[][] };

export interface QuestionableDay {
  date: string;
  reasons: Array<"lowScore" | "mixed" | "outliers">;
  bestScore: number;
  outlierCount: number;
  sources: string[];
}

export interface DeletePreview {
  points: number;
  days: Array<{ date: string; points: number; sources: Record<string, number> }>;
}

export interface DaySourceChoice {
  overrideSource?: string | null;
  outlierDecision?: OutlierDecision | null;
}

export const daySourcesApi = {
  questionable: async (page = 0): Promise<{ total: number; days: QuestionableDay[] }> =>
    (
      await api.get<{ total: number; days: QuestionableDay[] }>(
        "/travtrack/day-sources/questionable",
        { params: { page } }
      )
    ).data,
  day: async (date: string): Promise<DaySourceSummary> =>
    (await api.get<DaySourceSummary>(`/travtrack/day-sources/${date}`)).data,
  choose: async (date: string, choice: DaySourceChoice): Promise<DaySourceSummary> =>
    (await api.put<DaySourceSummary>(`/travtrack/day-sources/${date}`, choice)).data,
  deletePreview: async (span: { fromDay: string; toDay: string }): Promise<DeletePreview> =>
    (await api.get<DeletePreview>("/travtrack/points/delete-preview", { params: span })).data,
};
