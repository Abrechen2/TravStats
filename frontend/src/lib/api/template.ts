import { api } from "./client";
import type { TemplatePreviewResult, TemplateStatusResult, UserTemplateItem } from "./types";

// Utility function: Calculate distance between two coordinates using Haversine formula
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number): number => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const templateApi = {
  getStatus: async (): Promise<TemplateStatusResult> => {
    const res = await api.get<TemplateStatusResult>("/template-status");
    return res.data;
  },
  sync: async (): Promise<TemplateStatusResult> => {
    const res = await api.post<TemplateStatusResult>("/template-status/sync");
    return res.data;
  },
};

export const parserTemplatesApi = {
  list: async (): Promise<UserTemplateItem[]> => {
    const res = await api.get<{ templates: UserTemplateItem[] }>("/parser-templates");
    return res.data.templates;
  },
  getById: async (id: string): Promise<UserTemplateItem> => {
    const res = await api.get<{ template: UserTemplateItem }>(`/parser-templates/${id}`);
    return res.data.template;
  },
  /**
   * Run a derived template before trusting it — forgejo#124 phase 6.
   *
   * Against the sample it came from AND a held-out one, through the real
   * engine. `setStatus("active")` is refused with 409 `PREVIEW_REQUIRED`
   * until this has answered `canActivate`.
   */
  preview: async (id: string): Promise<TemplatePreviewResult> => {
    const res = await api.post<TemplatePreviewResult>(`/parser-templates/${id}/preview`);
    return res.data;
  },
  setStatus: async (id: string, status: "active" | "disabled" | "pending"): Promise<void> => {
    await api.patch(`/parser-templates/${id}`, { status });
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/parser-templates/${id}`);
  },
};
