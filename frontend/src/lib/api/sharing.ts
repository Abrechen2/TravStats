import { api } from "./client";
import type {
  LinkableCompanion,
  LinkableCompanionList,
  ShareConsent,
  ShareConsentList,
  ShareNotice,
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

  inboxCount: async (): Promise<number> => {
    const { data } = await api.get<Envelope<{ count: number }>>("/sharing/inbox/count");
    return data.data.count;
  },
};
