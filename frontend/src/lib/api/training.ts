import type { ParseLogStats, PromoteCorrectionsResult } from "../../types";

import { api } from "./client";
import type { TrainingAnnotationResult, TrainingDataEntry, TrainingUploadResult } from "./types";

// Training API
export const trainingApi = {
  upload: async (file: File, type: "email" | "boarding_pass"): Promise<TrainingUploadResult> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    const { data } = await api.post<TrainingUploadResult>("/training/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return data;
  },
  annotate: async (
    id: string,
    annotations: Record<string, unknown>,
    extractedData: Record<string, unknown>[],
    tags?: string[]
  ): Promise<TrainingAnnotationResult> => {
    const { data } = await api.post<TrainingAnnotationResult>(`/training/${id}/annotate`, {
      annotations,
      extractedData,
      tags: tags || [],
    });
    return data;
  },
  getById: async (id: string): Promise<TrainingDataEntry> => {
    const { data } = await api.get<TrainingDataEntry>(`/training/${id}`);
    return data;
  },
  getParseLogStats: async (): Promise<ParseLogStats> => {
    const { data } = await api.get<ParseLogStats>("/admin/parse-logs/stats");
    return data;
  },
  exportParseLogs: async (): Promise<void> => {
    const response = await api.get<Blob>("/admin/parse-logs/export", {
      responseType: "blob",
    });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parse-training-logs.jsonl";
    a.click();
    URL.revokeObjectURL(url);
  },
  promoteCorrections: async (): Promise<PromoteCorrectionsResult> => {
    const { data } = await api.post<PromoteCorrectionsResult>("/admin/parse-logs/promote");
    return data;
  },
};
