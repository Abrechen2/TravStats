import { api } from "./client";

interface SuggestionsResponse {
  suggestions: string[];
}

export const suggestionsApi = {
  airlines: async (): Promise<string[]> => {
    const { data } = await api.get<SuggestionsResponse>("/suggestions/airlines");
    return data.suggestions;
  },

  aircraft: async (): Promise<string[]> => {
    const { data } = await api.get<SuggestionsResponse>("/suggestions/aircraft");
    return data.suggestions;
  },
};
