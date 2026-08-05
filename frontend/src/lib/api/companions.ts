import { api } from "./client";

export interface Companion {
  id: string;
  name: string;
  usageCount: number;
}

// Companion API
export const companionsApi = {
  list: async (): Promise<Companion[]> => {
    const { data } = await api.get<{ companions: Companion[] }>("/companions");
    return data.companions;
  },
};
