import { api } from "./client";

export interface DiagnosticBundle {
  generatedAt: string;
  version: string;
  platform: {
    nodeVersion: string;
    os: string;
    uptimeSeconds: number;
  };
  logs: {
    stats: {
      totalSize: number;
      totalSizeFormatted: string;
      fileCount: number;
      oldestLog?: string;
      newestLog?: string;
      categoryBreakdown: Record<string, number>;
    };
    files: Array<{ name: string; sizeBytes: number; lastModified: string }>;
    appTail: Array<Record<string, unknown>>;
    errorTail: Array<Record<string, unknown>>;
  };
  notes: string;
}

export const diagnosticExportApi = {
  fetch: async (): Promise<DiagnosticBundle> => {
    const { data } = await api.get<DiagnosticBundle>("/diagnostic-export");
    return data;
  },
};
