import { api } from "./client";
import type { DomainKey } from "../../shared/domains";

/**
 * One upcoming entry from `GET /api/v1/upcoming` — at most one per domain,
 * soonest first, and only for domains the account has switched on (the server
 * enforces that, so no caller can forget it).
 */
export interface UpcomingEntry {
  domain: DomainKey | "trip";
  id: string;
  /** ISO instant it starts: departure, embarkation, check-in, trip start. */
  startsAt: string;
  /**
   * The row a click opens. Equal to `id` everywhere except lodging, where it
   * is the LODGING's id — a stay has no page of its own (see the server's
   * `nextStay`). Mirrors `backend/src/routes/upcoming.ts`; change both.
   */
  detailId: string;
  tripId: string | null;
  /** The trip's name, when the entry is part of one — shown, not just linked. */
  tripName: string | null;
  /** Headline — "München → Wien", a ship, a hotel, a trip name. */
  primary: string;
  /** Qualifier under it — flight number, port, city, destination. */
  secondary: string | null;
}

export const getUpcoming = async (): Promise<UpcomingEntry[]> => {
  const { data } = await api.get<{ success: boolean; data: { entries: UpcomingEntry[] } }>(
    "/upcoming"
  );
  return data.data.entries;
};
