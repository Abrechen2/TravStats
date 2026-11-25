import { api } from "./client";
import type {
  LinkableCompanion,
  LinkableCompanionList,
  ShareConsent,
  ShareConsentList,
  ShareNotice,
  ReceivedTrips,
  ShareResult,
  TripSharing,
} from "../../types/sharing";

/**
 * Shared trips (`/api/v1/sharing`). Enveloped (`{success, data}`), per
 * `docs/adr/0001-api-response-shape.md`. A failure is thrown as the axios
 * error; `sharingErrorKey` turns its code into the sentence the user sees.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

const enc = encodeURIComponent;

export const sharingApi = {
  listConsents: async (): Promise<ShareConsentList> => {
    const { data } = await api.get<Envelope<ShareConsentList>>("/sharing/consents");
    return data.data;
  },

  requestConsent: async (username: string): Promise<ShareConsent> => {
    const { data } = await api.post<Envelope<ShareConsent>>("/sharing/consents", { username });
    return data.data;
  },

  answerConsent: async (
    id: string,
    action: "accept" | "decline" | "withdraw"
  ): Promise<ShareConsent> => {
    const { data } = await api.post<Envelope<ShareConsent>>(
      `/sharing/consents/${enc(id)}/${action}`
    );
    return data.data;
  },

  listCompanions: async (): Promise<LinkableCompanionList> => {
    const { data } = await api.get<Envelope<LinkableCompanionList>>("/sharing/companions");
    return data.data;
  },

  linkCompanion: async (companionId: string, userId: string): Promise<LinkableCompanion> => {
    const { data } = await api.put<Envelope<LinkableCompanion>>(
      `/sharing/companions/${enc(companionId)}/link`,
      { userId }
    );
    return data.data;
  },

  unlinkCompanion: async (companionId: string): Promise<LinkableCompanion> => {
    const { data } = await api.delete<Envelope<LinkableCompanion>>(
      `/sharing/companions/${enc(companionId)}/link`
    );
    return data.data;
  },

  /** One person, one companion: the reader's companion IS this person on another server. */
  linkRemoteCompanion: async (companionId: string, remoteId: string): Promise<void> => {
    await api.put(`/sharing/companions/${enc(companionId)}/remote-link`, { remoteId });
  },

  /** "Not the same person": remembered, the question is not asked again. */
  markNotSameRemote: async (companionId: string, remoteId: string): Promise<void> => {
    await api.post(`/sharing/companions/${enc(companionId)}/not-same`, { remoteId });
  },

  /** Trips shared with the reader not looked at yet (dashboard banner, nav dot). */
  receivedTrips: async (): Promise<ReceivedTrips> => {
    const { data } = await api.get<Envelope<ReceivedTrips>>("/sharing/received-trips");
    return data.data;
  },

  markReceivedTripsSeen: async (): Promise<void> => {
    await api.post("/sharing/received-trips/seen");
  },

  tripSharing: async (tripId: string): Promise<TripSharing> => {
    const { data } = await api.get<Envelope<TripSharing>>(`/sharing/trips/${enc(tripId)}`);
    return data.data;
  },

  shareTrip: async (tripId: string, companionId: string): Promise<ShareResult> => {
    const { data } = await api.post<Envelope<ShareResult>>(`/sharing/trips/${enc(tripId)}/share`, {
      companionId,
    });
    return data.data;
  },

  leaveGroup: async (tripId: string): Promise<void> => {
    await api.post(`/sharing/trips/${enc(tripId)}/leave`);
  },

  listNotices: async (): Promise<ShareNotice[]> => {
    const { data } = await api.get<Envelope<{ notices: ShareNotice[] }>>("/sharing/notices");
    return data.data.notices;
  },

  markNoticeRead: async (id: string): Promise<void> => {
    await api.post(`/sharing/notices/${enc(id)}/read`);
  },

  /** Restore what another member's change replaced, on the reader's own copy. */
  undoNotice: async (id: string): Promise<void> => {
    await api.post(`/sharing/notices/${enc(id)}/undo`);
  },

  /** Answer a conflict with another server: take their value, or keep one's own (F-S4d). */
  resolveConflict: async (id: string, choice: "mine" | "theirs"): Promise<void> => {
    await api.post(`/sharing/notices/${enc(id)}/resolve`, { choice });
  },

  /** After another member deleted an entry: delete the reader's own copy too. */
  deleteOwnCopy: async (id: string): Promise<void> => {
    await api.post(`/sharing/notices/${enc(id)}/delete-copy`);
  },

  inboxCount: async (): Promise<number> => {
    const { data } = await api.get<Envelope<{ count: number }>>("/sharing/inbox/count");
    return data.data.count;
  },
};
