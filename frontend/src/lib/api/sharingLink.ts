import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";
import type { LinkCandidate, LinkDecision, LinkPreview, LinkResult } from "../../types/sharingLink";

/**
 * Linking an existing copy of a trip (forgejo#440), enveloped like the rest of `/sharing`. The
 * remote calls read the other server, so they get the cross-server timeout.
 */
interface Envelope<T> {
  success: boolean;
  data: T;
}

const enc = encodeURIComponent;
const ACROSS = { timeout: API_TIMEOUTS.REMOTE_SHARING };

export const sharingLinkApi = {
  candidates: async (tripId: string, userId: string): Promise<LinkCandidate[]> =>
    (
      await api.get<Envelope<LinkCandidate[]>>(`/sharing/trips/${enc(tripId)}/link-candidates`, {
        params: { userId },
      })
    ).data.data,
  preview: async (tripId: string, userId: string, targetTripId: string): Promise<LinkPreview> =>
    (
      await api.post<Envelope<LinkPreview>>(`/sharing/trips/${enc(tripId)}/link-preview`, {
        userId,
        targetTripId,
      })
    ).data.data,
  link: async (
    tripId: string,
    userId: string,
    targetTripId: string,
    decision: LinkDecision
  ): Promise<LinkResult> =>
    (
      await api.post<Envelope<LinkResult>>(`/sharing/trips/${enc(tripId)}/link`, {
        userId,
        targetTripId,
        decision,
      })
    ).data.data,

  offerCandidates: async (offerId: string): Promise<LinkCandidate[]> =>
    (
      await api.get<Envelope<LinkCandidate[]>>(
        `/sharing/remote/offers/${enc(offerId)}/link-candidates`
      )
    ).data.data,
  offerPreview: async (offerId: string, tripId: string): Promise<LinkPreview> =>
    (
      await api.post<Envelope<LinkPreview>>(
        `/sharing/remote/offers/${enc(offerId)}/link-preview`,
        { tripId },
        ACROSS
      )
    ).data.data,
  offerLink: async (offerId: string, tripId: string, decision: LinkDecision): Promise<LinkResult> =>
    (
      await api.post<Envelope<LinkResult>>(
        `/sharing/remote/offers/${enc(offerId)}/link`,
        { tripId, decision },
        ACROSS
      )
    ).data.data,
};
