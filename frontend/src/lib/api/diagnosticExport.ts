import { api } from "./client";
import type { DiagnosticBundle } from "../../shared/logContract";

export type { DiagnosticBundle };

export const diagnosticExportApi = {
  fetch: async (): Promise<DiagnosticBundle> => {
    const { data } = await api.get<DiagnosticBundle>("/diagnostic-export");
    return data;
  },
};
