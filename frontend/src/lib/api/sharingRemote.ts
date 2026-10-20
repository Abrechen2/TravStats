import { api } from "./client";
import type {
  CreatedRemoteInvite,
  RemoteInvite,
  RemotePerson,
  RemoteSharingStatus,
} from "../../types/sharingRemote";

/**
 * People on other TravStats servers (`/api/v1/sharing/remote`, spec 2026-10-20 F-S4b).
 * Enveloped like `/sharing`. A failure is thrown as the axios error; `remoteSharingError`
 * turns its code into the sentence the user sees.
 */
interface Envelope<T> {
  success: boolean;
  data: T;
}
const BASE = "/sharing/remote";

export const sharingRemoteApi = {
  status: async (): Promise<RemoteSharingStatus> =>
    (await api.get<Envelope<RemoteSharingStatus>>(`${BASE}/status`)).data.data,
  listInvites: async (): Promise<RemoteInvite[]> =>
    (await api.get<Envelope<RemoteInvite[]>>(`${BASE}/invites`)).data.data,
  createInvite: async (): Promise<CreatedRemoteInvite> =>
    (await api.post<Envelope<CreatedRemoteInvite>>(`${BASE}/invites`)).data.data,
  revokeInvite: async (id: string): Promise<void> => {
    await api.delete(`${BASE}/invites/${encodeURIComponent(id)}`);
  },
  claim: async (code: string): Promise<RemotePerson> =>
    (await api.post<Envelope<RemotePerson>>(`${BASE}/claim`, { code })).data.data,
  listPeople: async (): Promise<RemotePerson[]> =>
    (await api.get<Envelope<RemotePerson[]>>(`${BASE}/people`)).data.data,
};
