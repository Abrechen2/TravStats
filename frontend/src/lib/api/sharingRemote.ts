import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";
import type {
  AddRequestBody,
  ClaimedPerson,
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
/** For the calls that wait on another server (`API_TIMEOUTS.REMOTE_SHARING`). */
const ACROSS = { timeout: API_TIMEOUTS.REMOTE_SHARING };

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
  claim: async (code: string): Promise<ClaimedPerson> =>
    (await api.post<Envelope<ClaimedPerson>>(`${BASE}/claim`, { code }, ACROSS)).data.data,
  listPeople: async (): Promise<RemotePerson[]> =>
    (await api.get<Envelope<RemotePerson[]>>(`${BASE}/people`)).data.data,
  tripSharing: async (tripId: string): Promise<TripRemoteSharing> =>
    (await api.get<Envelope<TripRemoteSharing>>(`${BASE}/trips/${encodeURIComponent(tripId)}`)).data
      .data,
  offerTrip: async (tripId: string, remoteId: string): Promise<RemoteMember> =>
    (
      await api.post<Envelope<RemoteMember>>(
        `${BASE}/trips/${encodeURIComponent(tripId)}/offers`,
        { remoteId },
        ACROSS
      )
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
        `${BASE}/offers/${encodeURIComponent(id)}/accept`,
        undefined,
        ACROSS
      )
    ).data.data,
  declineOffer: async (id: string): Promise<void> => {
    await api.post(`${BASE}/offers/${encodeURIComponent(id)}/decline`, undefined, ACROSS);
  },
  // The lifecycle (F-S4e).
  withdrawPerson: async (id: string): Promise<RemotePerson> =>
    (await api.post<Envelope<RemotePerson>>(`${BASE}/people/${encodeURIComponent(id)}/withdraw`))
      .data.data,
  decideRosterPerson: async (
    tripId: string,
    ref: string,
    decision: "accepted" | "declined"
  ): Promise<TripRemoteSharing> =>
    (
      await api.post<Envelope<TripRemoteSharing>>(
        `${BASE}/trips/${encodeURIComponent(tripId)}/roster/${encodeURIComponent(ref)}`,
        { decision }
      )
    ).data.data,
  reconfirm: async (tripId: string): Promise<TripRemoteSharing> =>
    (
      await api.post<Envelope<TripRemoteSharing>>(
        `${BASE}/trips/${encodeURIComponent(tripId)}/reconfirm`
      )
    ).data.data,
  dismissParked: async (tripId: string, memberId: string): Promise<TripRemoteSharing> =>
    (
      await api.delete<Envelope<TripRemoteSharing>>(
        `${BASE}/trips/${encodeURIComponent(tripId)}/members/${encodeURIComponent(memberId)}/parked`
      )
    ).data.data,
  requestAddition: async (
    tripId: string,
    body: AddRequestBody
  ): Promise<{ requested: true; origin: string }> =>
    (
      await api.post<Envelope<{ requested: true; origin: string }>>(
        `${BASE}/trips/${encodeURIComponent(tripId)}/add-requests`,
        body,
        ACROSS
      )
    ).data.data,
};
