import { api } from "./client";
import type { FerryJourney } from "../../types/ferry";
interface Envelope<T> {
  success: boolean;
  data: T;
}
export interface FerryRoadtripLeg {
  id: string;
  mode: string;
  ferryJourney: { id: string } | null;
  fromStop: { title: string };
  toStop: { title: string };
  route: { name: string; tripId: string | null };
}
export const ferryApi = {
  async roadtripLegs() {
    return (await api.get<Envelope<FerryRoadtripLeg[]>>("/ferry/roadtrip-legs")).data.data;
  },
  async linkLeg(id: string, legId: string | null) {
    await api.put(`/ferry/${encodeURIComponent(id)}/roadtrip-leg`, { legId });
  },
  async list(offset = 0, q = "") {
    const { data } = await api.get<Envelope<FerryJourney[]> & { meta: { total: number } }>(
      "/ferry",
      { params: { offset, limit: 50, ...(q && { q }) } }
    );
    return { journeys: data.data, total: data.meta.total };
  },
  async listAll() {
    const rows: FerryJourney[] = [];
    for (let offset = 0; ; offset += 50) {
      const page = await ferryApi.list(offset);
      rows.push(...page.journeys);
      if (rows.length >= page.total || page.journeys.length === 0) return rows;
    }
  },
  async get(id: string) {
    return (await api.get<Envelope<FerryJourney>>(`/ferry/${encodeURIComponent(id)}`)).data.data;
  },
  async save(id: string | null, input: unknown) {
    const response = id
      ? await api.patch<Envelope<FerryJourney>>(`/ferry/${encodeURIComponent(id)}`, input)
      : await api.post<Envelope<FerryJourney>>("/ferry", input);
    return response.data.data;
  },
  async remove(id: string) {
    await api.delete(`/ferry/${encodeURIComponent(id)}`);
  },
};
