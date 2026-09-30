import { api } from "./client";
import type {
  TripSuggestionAccepted,
  TripSuggestionEdits,
  TripSuggestionList,
} from "../../types/tripSuggestion";

/**
 * The trip-suggestion inbox (`/api/v1/trip-suggestions`). Enveloped
 * (`{success, data}`), per `docs/adr/0001-api-response-shape.md`.
 *
 * Unlike the photo-journey inbox, the SERVER does the accepting: one
 * transaction creates or widens the trip and links every chosen entry, so a
 * failure leaves nothing half done and there is nothing for a client to retry
 * piecemeal. A failure is thrown as the axios error; `tripSuggestionErrorKey`
 * turns its code into the sentence the user sees.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** Ids carry colons; they travel URL-encoded. */
const path = (id: string, action: "accept" | "dismiss"): string =>
  `/trip-suggestions/${encodeURIComponent(id)}/${action}`;

export const tripSuggestionsApi = {
  list: async (): Promise<TripSuggestionList> => {
    const { data } = await api.get<Envelope<TripSuggestionList>>("/trip-suggestions");
    return data.data;
  },

  count: async (): Promise<number> => {
    const { data } = await api.get<Envelope<{ count: number }>>("/trip-suggestions/count");
    return data.data.count;
  },

  accept: async (id: string, edits: TripSuggestionEdits): Promise<TripSuggestionAccepted> => {
    const { data } = await api.post<Envelope<TripSuggestionAccepted>>(path(id, "accept"), edits);
    return data.data;
  },

  dismiss: async (id: string): Promise<void> => {
    await api.post(path(id, "dismiss"));
  },
};
