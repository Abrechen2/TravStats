import type { TripPhoto } from "./index";
import type { ObservedWeather } from "./openData";

/**
 * A diary entry of a trip. Its own module since the entry gained photos: the
 * shared `types/index.ts` sits at the line limit, and the entry is read by the
 * journal components far more than by anything else there.
 */
export interface TripJournalEntry {
  id: string;
  tripId: string;
  date: string;
  title: string | null;
  body: string;
  mood: string | null;
  weather: string | null;
  /** The day's measured weather at the trip's stop, from Open-Meteo. Absent on older backends. */
  observedWeather?: ObservedWeather | null;
  /**
   * Photos of the trip's own gallery the entry shows, in the author's order.
   * Present on the trip detail; absent from the entry a save answers with.
   */
  photos?: TripPhoto[];
  createdAt: string;
  updatedAt: string;
}
