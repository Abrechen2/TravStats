import { api } from "./client";
import type {
  CreatedRemoteInvite,
  ReceivedOffer,
  RemoteInvite,
  RemoteMember,
  RemotePerson,
  RemoteSharingStatus,
  TripRemoteSharing,
} from "../../types/sharingRemote";

/**
 * People on other TravStats servers (`/api/v1/sharing/remote`, spec 2026-10-20 F-S4b/F-S4c).
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
  tripSharing: async (tripId: string): Promise<TripRemoteSharing> =>
    (await api.get<Envelope<TripRemoteSharing>>(`${BASE}/trips/${encodeURIComponent(tripId)}`)).data
      .data,
  offerTrip: async (tripId: string, remoteId: string): Promise<RemoteMember> =>
    (
      await api.post<Envelope<RemoteMember>>(`${BASE}/trips/${encodeURIComponent(tripId)}/offers`, {
        remoteId,
      })
    ).data.data,
  createTripInvite: async (tripId: string): Promise<CreatedRemoteInvite> =>
    (
      await api.post<Envelope<CreatedRemoteInvite>>(
        `${BASE}/trips/${encodeURIComponent(tripId)}/invites`
      )
    ).data.data,
  listOffers: async (): Promise<ReceivedOffer[]> =>
    (await api.get<Envelope<ReceivedOffer[]>>(`${BASE}/offers`)).data.data,
  acceptOffer: async (id: string): Promise<{ tripId: string }> =>
    (
      await api.post<Envelope<{ tripId: string }>>(
        `${BASE}/offers/${encodeURIComponent(id)}/accept`
      )
    ).data.data,
  declineOffer: async (id: string): Promise<void> => {
    await api.post(`${BASE}/offers/${encodeURIComponent(id)}/decline`);
  },
};
