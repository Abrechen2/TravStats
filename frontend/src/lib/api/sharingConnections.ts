import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";
import type { Connection, ConnectionSwitches, RemoteAchievements } from "../../types/sharingRemote";

/**
 * User connections across servers (`/api/v1/sharing/connections`, spec 2026-11-02 §5). Enveloped.
 * Ask and confirm wait on the other server, so they get the cross-server timeout.
 */
interface Envelope<T> {
  success: boolean;
  data: T;
}
const BASE = "/sharing/connections";
const ACROSS = { timeout: API_TIMEOUTS.REMOTE_SHARING };
const enc = encodeURIComponent;

export const sharingConnectionsApi = {
  list: async (): Promise<Connection[]> => (await api.get<Envelope<Connection[]>>(BASE)).data.data,
  request: async (
    origin: string,
    username: string,
    switches: ConnectionSwitches
  ): Promise<Connection> =>
    (await api.post<Envelope<Connection>>(BASE, { origin, username, switches }, ACROSS)).data.data,
  accept: async (id: string, switches: ConnectionSwitches): Promise<Connection> =>
    (await api.post<Envelope<Connection>>(`${BASE}/${enc(id)}/accept`, { switches }, ACROSS)).data
      .data,
  decline: async (id: string): Promise<Connection> =>
    (await api.post<Envelope<Connection>>(`${BASE}/${enc(id)}/decline`, undefined, ACROSS)).data
      .data,
  setSwitches: async (id: string, switches: ConnectionSwitches): Promise<Connection> =>
    (await api.put<Envelope<Connection>>(`${BASE}/${enc(id)}/switches`, { switches }, ACROSS)).data
      .data,
  achievements: async (id: string): Promise<RemoteAchievements> =>
    (await api.get<Envelope<RemoteAchievements>>(`${BASE}/${enc(id)}/achievements`, ACROSS)).data
      .data,
  end: async (id: string): Promise<Connection> =>
    (await api.delete<Envelope<Connection>>(`${BASE}/${enc(id)}`, ACROSS)).data.data,
};
