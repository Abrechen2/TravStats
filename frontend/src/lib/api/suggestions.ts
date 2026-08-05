import { api } from "./client";

interface SuggestionsResponse {
  suggestions: string[];
}

export const suggestionsApi = {
  airlines: async (q?: string): Promise<string[]> => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const { data } = await api.get<SuggestionsResponse>("/suggestions/airlines", { params });
    return data.suggestions;
  },

  aircraft: async (): Promise<string[]> => {
    const { data } = await api.get<SuggestionsResponse>("/suggestions/aircraft");
    return data.suggestions;
  },
};
