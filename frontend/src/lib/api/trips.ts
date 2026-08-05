import { api } from "./client";
import { API_TIMEOUTS } from "../../config/constants";
import type {
  Trip,
  Booking,
  TripStatus,
  TripCategory,
  TripStop,
  TripJournalEntry,
  TripPhoto,
  UpdateBookingInput,
} from "../../types";

export interface CreateTripInput {
  name: string;
  description?: string;
  color?: string;
  startDate?: string;
  endDate?: string;
  status?: TripStatus;
  category?: TripCategory;
  tags?: string[];
  companions?: string[];
  notes?: string;
  summary?: string;
  originLabel?: string;
  destinationLabel?: string;
  coverImageUrl?: string;
  icon?: string;
  countries?: string[];
}

// PATCH semantics: explicit `null` clears nullable fields,
// `undefined` leaves them untouched. Arrays replace the whole list.
export interface UpdateTripInput {
  name?: string;
  description?: string | null;
  color?: string;
  startDate?: string | null;
  endDate?: string | null;
  status?: TripStatus;
  category?: TripCategory | null;
  tags?: string[];
  companions?: string[];
  notes?: string | null;
  summary?: string | null;
  originLabel?: string | null;
  destinationLabel?: string | null;
  coverImageUrl?: string | null;
  icon?: string | null;
  countries?: string[];
}

export interface AssignFlightsInput {
  flightIds: string[];
  action: "add" | "remove";
}

export interface CreateBookingInput {
  tripId?: string;
  pnr?: string;
  price?: number;
  /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …). */
  currency?: string;
  flightIds?: string[];
}

/** A trip that qualifies for dissolution (≤2 flights, no other content). */
export interface MicroTripCandidate {
  id: string;
  name: string;
  color: string;
  flightCount: number;
  startDate: string | null;
  endDate: string | null;
}

export const tripsApi = {
  getAll: async (): Promise<Trip[]> => {
    const { data } = await api.get<{ trips: Trip[] }>("/trips");
    return data.trips;
  },

  getById: async (id: string): Promise<Trip> => {
    const { data } = await api.get<{ trip: Trip }>(`/trips/${id}`);
    return data.trip;
  },

  create: async (input: CreateTripInput): Promise<Trip> => {
    const { data } = await api.post<{ trip: Trip }>("/trips", input);
    return data.trip;
  },

  update: async (id: string, input: UpdateTripInput): Promise<Trip> => {
    const { data } = await api.patch<{ trip: Trip }>(`/trips/${id}`, input);
    return data.trip;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/trips/${id}`);
  },

  assignFlights: async (tripId: string, input: AssignFlightsInput): Promise<void> => {
    await api.post(`/trips/${tripId}/flights`, input);
  },

  createBooking: async (input: CreateBookingInput): Promise<Booking> => {
    const { data } = await api.post<{ booking: Booking }>("/trips/bookings", input);
    return data.booking;
  },

  updateBooking: async (id: string, input: UpdateBookingInput): Promise<Booking> => {
    const { data } = await api.patch<{ booking: Booking }>(`/trips/bookings/${id}`, input);
    return data.booking;
  },

  /* ─────────── Cleanup (micro-trip dissolve + merge) ─────────── */

  getMicroTripCandidates: async (): Promise<MicroTripCandidate[]> => {
    const { data } = await api.get<{ candidates: MicroTripCandidate[] }>("/trips/cleanup/micro");
    return data.candidates;
  },

  dissolveMicroTrips: async (
    tripIds: string[]
  ): Promise<{ dissolved: number; skipped: number }> => {
    const { data } = await api.post<{ dissolved: number; skipped: number }>(
      "/trips/cleanup/dissolve",
      { tripIds }
    );
    return data;
  },

  merge: async (input: {
    tripIds: string[];
    name?: string;
    targetId?: string;
  }): Promise<{ tripId: string; merged: number }> => {
    const { data } = await api.post<{ tripId: string; merged: number }>("/trips/merge", input);
    return data;
  },

  detect: async (
    input: {
      dryRun?: boolean;
      selectedProposals?: Array<{
        flightIds: string[];
        name: string;
        pnr?: string | null;
        source?: ProposedTrip["source"];
      }>;
    } = { dryRun: true }
  ): Promise<DetectTripsResult> => {
    const { data } = await api.post<DetectTripsResult>("/trips/detect", input);
    return data;
  },

  /* ─────────── Stops ─────────── */

  createStop: async (tripId: string, input: CreateStopInput): Promise<TripStop> => {
    const { data } = await api.post<{ stop: TripStop }>(`/trips/${tripId}/stops`, input);
    return data.stop;
  },
  updateStop: async (tripId: string, stopId: string, input: UpdateStopInput): Promise<TripStop> => {
    const { data } = await api.patch<{ stop: TripStop }>(`/trips/${tripId}/stops/${stopId}`, input);
    return data.stop;
  },
  deleteStop: async (tripId: string, stopId: string): Promise<void> => {
    await api.delete(`/trips/${tripId}/stops/${stopId}`);
  },

  /* ─────────── Journal entries ─────────── */

  createJournalEntry: async (
    tripId: string,
    input: CreateJournalInput
  ): Promise<TripJournalEntry> => {
    const { data } = await api.post<{ entry: TripJournalEntry }>(`/trips/${tripId}/journal`, input);
    return data.entry;
  },
  updateJournalEntry: async (
    tripId: string,
    entryId: string,
    input: UpdateJournalInput
  ): Promise<TripJournalEntry> => {
    const { data } = await api.patch<{ entry: TripJournalEntry }>(
      `/trips/${tripId}/journal/${entryId}`,
      input
    );
    return data.entry;
  },
  deleteJournalEntry: async (tripId: string, entryId: string): Promise<void> => {
    await api.delete(`/trips/${tripId}/journal/${entryId}`);
  },

  /* ─────────── Photos ─────────── */

  uploadPhotos: async (tripId: string, files: File[]): Promise<TripPhoto[]> => {
    const fd = new FormData();
    for (const f of files) fd.append("photos", f);
    const { data } = await api.post<{ photos: TripPhoto[] }>(`/trips/${tripId}/photos`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data.photos;
  },
  updatePhoto: async (
    tripId: string,
    photoId: string,
    input: { caption?: string | null; takenAt?: string | null; sortIdx?: number }
  ): Promise<TripPhoto> => {
    const { data } = await api.patch<{ photo: TripPhoto }>(
      `/trips/${tripId}/photos/${photoId}`,
      input
    );
    return data.photo;
  },
  deletePhoto: async (tripId: string, photoId: string): Promise<void> => {
    await api.delete(`/trips/${tripId}/photos/${photoId}`);
  },
  uploadCover: async (tripId: string, file: File): Promise<{ trip: Trip; coverUrl: string }> => {
    const fd = new FormData();
    fd.append("cover", file);
    const { data } = await api.post<{ trip: Trip; coverUrl: string }>(
      `/trips/${tripId}/cover`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return data;
  },

  /* ─────────── LLM summary ─────────── */

  summarize: async (
    tripId: string
  ): Promise<{ summary: string; model: string; durationMs: number }> => {
    // Ollama generation routinely takes >10s, so use the long PARSER timeout —
    // the 10s DEFAULT aborts the request while the backend is still generating,
    // surfacing an error toast even though the summary succeeds server-side.
    const { data } = await api.post<{ summary: string; model: string; durationMs: number }>(
      `/trips/${tripId}/summarize`,
      undefined,
      { timeout: API_TIMEOUTS.PARSER }
    );
    return data;
  },
};

export interface CreateStopInput {
  title: string;
  domain?: string;
  sourceId?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  lat?: number;
  lon?: number;
  notes?: string;
  orderIdx?: number;
}

export interface UpdateStopInput {
  title?: string;
  domain?: string | null;
  sourceId?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  lat?: number | null;
  lon?: number | null;
  notes?: string | null;
  orderIdx?: number;
}

export interface CreateJournalInput {
  date: string;
  title?: string;
  body: string;
  mood?: string;
  weather?: string;
}

export interface UpdateJournalInput {
  date?: string;
  title?: string | null;
  body?: string;
  mood?: string | null;
  weather?: string | null;
}

export interface ProposedTripLeg {
  date: string;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  status: string;
}

export interface ProposedTrip {
  source: "pnr" | "home_loop" | "continuity";
  flightIds: string[];
  pnr: string | null;
  origin: string;
  destination: string;
  span: { from: string; to: string };
  suggestedName: string;
  /** Per-leg detail for the expandable review card (ordered by departure). */
  legs: ProposedTripLeg[];
}

export interface DetectTripsResult {
  proposed: ProposedTrip[];
  created: Array<{ tripId: string; flightIds: string[]; pnr: string | null }>;
  orphansRemoved: number;
}
