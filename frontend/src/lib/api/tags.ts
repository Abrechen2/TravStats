import { api } from "./client";

export interface TagSuggestion {
  name: string;
  usageCount: number;
}

export const tagsApi = {
  /** The user's own tags across flights, trips and cruises, most used first. */
  search: async (params: { q?: string; limit?: number } = {}): Promise<TagSuggestion[]> => {
    const { data } = await api.get<{ tags: TagSuggestion[] }>("/tags", { params });
    return data.tags;
  },
};
