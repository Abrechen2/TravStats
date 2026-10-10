import { api } from "./client";
import type {
  RentalBooking,
  RentalInput,
  RentalInvoiceReading,
  RentalStationHit,
} from "../../types/rental";
import type { RentalInvoicePart } from "../rental/rentalInvoiceDiff";

/**
 * `/api/v1/rentals` — the rental logbook (spec 2026-10-01-rental-domain-design).
 * Enveloped, like every newer domain's router.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** The summary strip's figures over the whole FILTERED list, counted by the server. */
export interface RentalListSummary {
  rentals: number;
  days: number;
  providers: number;
}

export interface RentalPage {
  rentals: RentalBooking[];
  total: number;
  summary: RentalListSummary;
}

export interface RentalListQuery {
  q?: string;
  year?: number;
  status?: string;
  provider?: string;
  tripId?: string;
  sort?: "pickup" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export const rentalApi = {
  /** The common providers, as suggestions for the free-text field (forgejo#196). */
  async listProviders(): Promise<{ id: string; name: string }[]> {
    const res = await api.get<Envelope<{ id: string; name: string }[]>>("/rentals/providers");
    return Array.isArray(res.data.data) ? res.data.data : [];
  },

  async list(query: RentalListQuery = {}): Promise<RentalPage> {
    const res = await api.get<
      Envelope<RentalBooking[]> & { meta: { total: number; summary: RentalListSummary } }
    >("/rentals", {
      params: query,
    });
    return { rentals: res.data.data, total: res.data.meta.total, summary: res.data.meta.summary };
  },

  /** Every rental matching `query`, a page of 500 (the endpoint's cap) at a time. */
  async listAll(query: Omit<RentalListQuery, "limit" | "offset"> = {}): Promise<RentalBooking[]> {
    const PAGE = 500;
    const all: RentalBooking[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await rentalApi.list({ ...query, limit: PAGE, offset });
      all.push(...page.rentals);
      if (page.rentals.length < PAGE || all.length >= page.total) return all;
    }
  },

  async get(id: string): Promise<RentalBooking> {
    const res = await api.get<Envelope<RentalBooking>>(`/rentals/${encodeURIComponent(id)}`);
    return res.data.data;
  },

  async create(input: RentalInput): Promise<RentalBooking> {
    const res = await api.post<Envelope<RentalBooking>>("/rentals", input);
    return res.data.data;
  },

  async update(id: string, input: Partial<RentalInput>): Promise<RentalBooking> {
    const res = await api.patch<Envelope<RentalBooking>>(
      `/rentals/${encodeURIComponent(id)}`,
      input
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/rentals/${encodeURIComponent(id)}`);
  },

  /**
   * One reviewed document applied (`POST /rentals/import`): the server decides
   * create vs update by the booking number; a cancellation or invoice for an
   * unknown booking is refused with `RENTAL_UNKNOWN_BOOKING`.
   */
  async importDocument(
    body:
      | { kind: "confirmation"; input: RentalInput; mailSentAt?: string | null }
      | {
          kind: "cancellation";
          provider: string;
          confirmationNumber: string;
          fee?: { amount: number; currency: string } | null;
          mailSentAt?: string | null;
        }
      | {
          kind: "invoice";
          invoice: RentalInvoiceReading;
          replaceUserDistance?: boolean;
          mailSentAt?: string | null;
          /** The invoice's parts the review took over; `false` leaves one as it is (forgejo#237). */
          adopt?: Partial<Record<RentalInvoicePart, boolean>> & {
            /** Indexes of `invoice.fees` taken over; absent = all, `[]` = none. */
            fees?: number[];
          };
        }
  ): Promise<{ rental: RentalBooking; outcome: string }> {
    const res = await api.post<Envelope<RentalBooking> & { meta: { outcome: string } }>(
      "/rentals/import",
      body
    );
    return { rental: res.data.data, outcome: res.data.meta.outcome };
  },

  /** Airports and the user's earlier stations matching `q`. */
  async searchStations(q: string): Promise<RentalStationHit[]> {
    const res = await api.get<Envelope<RentalStationHit[]>>("/rentals/stations", { params: { q } });
    return res.data.data;
  },
};
