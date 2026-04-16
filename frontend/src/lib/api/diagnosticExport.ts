import { api } from "./client";

interface SettingsSection {
  autoUpdate: {
    enabled: boolean;
    requireApproval: boolean;
    checkInterval: number;
    onlyDuringFlight: boolean;
    expiryHours: number;
  };
  historicalEnrichment: {
    enabled: boolean;
    minConfidence: number;
    maxPerDay: number;
  };
}

interface FlightStateSection {
  byStatus: {
    scheduled: number;
    flown: number;
    cancelled: number;
    historical: number;
    duplicated: number;
  };
  pipeline: {
    withNextApiCheck: number;
    withPendingUpdates: number;
    withLiveTracking: number;
    withActualTimes: number;
    zombieCandidates: number;
  };
}

type SectionError = { error: string };

export interface DiagnosticBundle {
  generatedAt: string;
  version: string;
  platform: {
    nodeVersion: string;
    os: string;
    uptimeSeconds: number;
  };
  settings: SettingsSection | SectionError;
  flightState: FlightStateSection | SectionError;
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
