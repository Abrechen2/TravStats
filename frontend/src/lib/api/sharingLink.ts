import { API_TIMEOUTS } from "../../config/constants";
import { api } from "./client";
import type {
  BulkOfferCandidate,
  BulkPairs,
  LinkCandidates,
  LinkChoices,
  LinkDecision,
  LinkPreviewAnswer,
  LinkResult,
} from "../../types/sharingLink";

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
  candidates: async (tripId: string, userId: string): Promise<LinkCandidates> =>
    (
      await api.get<Envelope<LinkCandidates>>(`/sharing/trips/${enc(tripId)}/link-candidates`, {
        params: { userId },
      })
    ).data.data,
  preview: async (
    tripId: string,
    userId: string,
    targetTripId: string
  ): Promise<LinkPreviewAnswer> =>
    (
      await api.post<Envelope<LinkPreviewAnswer>>(`/sharing/trips/${enc(tripId)}/link-preview`, {
        userId,
        targetTripId,
      })
    ).data.data,
  link: async (
    tripId: string,
    userId: string,
    targetTripId: string,
    decision: LinkDecision,
    choices: LinkChoices = {}
  ): Promise<LinkResult> =>
    (
      await api.post<Envelope<LinkResult>>(`/sharing/trips/${enc(tripId)}/link`, {
        userId,
        targetTripId,
        decision,
        choices,
      })
    ).data.data,

  offerCandidates: async (offerId: string): Promise<LinkCandidates> =>
    (
      await api.get<Envelope<LinkCandidates>>(
        `/sharing/remote/offers/${enc(offerId)}/link-candidates`
      )
    ).data.data,
  offerPreview: async (offerId: string, tripId: string): Promise<LinkPreviewAnswer> =>
    (
      await api.post<Envelope<LinkPreviewAnswer>>(
        `/sharing/remote/offers/${enc(offerId)}/link-preview`,
        { tripId },
        ACROSS
      )
    ).data.data,
  offerLink: async (
    offerId: string,
    tripId: string,
    decision: LinkDecision,
    choices: LinkChoices = {}
  ): Promise<LinkResult> =>
    (
      await api.post<Envelope<LinkResult>>(
        `/sharing/remote/offers/${enc(offerId)}/link`,
        { tripId, decision, choices },
        ACROSS
      )
    ).data.data,

  /** The bulk link (UAT 2026-11-27): the pairs, then one dry run and one link per pair. */
  bulkPairs: async (userId: string): Promise<BulkPairs> =>
    (await api.get<Envelope<BulkPairs>>("/sharing/link-bulk", { params: { userId } })).data.data,
  remoteBulkPairs: async (): Promise<BulkPairs> =>
    (await api.get<Envelope<BulkPairs>>("/sharing/remote/link-bulk")).data.data,
  bulkOfferCandidates: async (remoteId: string): Promise<BulkOfferCandidate[]> =>
    (
      await api.get<Envelope<BulkOfferCandidate[]>>("/sharing/remote/link-bulk/offers", {
        params: { remoteId },
      })
    ).data.data,
  bulkOffer: async (tripId: string, remoteId: string): Promise<void> => {
    await api.post("/sharing/remote/link-bulk/offers", { tripId, remoteId }, ACROSS);
  },
  /** Undo one pair: the caller's trip leaves its group; both keep their entries. */
  leave: async (tripId: string): Promise<void> => {
    await api.post(`/sharing/trips/${enc(tripId)}/leave`);
  },
};
