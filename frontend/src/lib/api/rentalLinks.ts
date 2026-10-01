import { api } from "./client";
import type { RentalBooking } from "../../types/rental";
import type { TimeValue } from "../../shared/time";

/**
 * A rental's statistics, suggestions and invoice reminders (spec
 * 2026-10-01-rental-domain-design §7, §7.4, D11 b) — the parts of
 * `/api/v1/rentals` beyond the logbook rows.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface RentalStats {
  rentals: number;
  days: number;
  oneWay: number;
  byYear: Array<{ year: number; rentals: number; days: number }>;
  providers: Array<{ provider: string; rentals: number; days: number }>;
  brokers: Array<{ broker: string; rentals: number }>;
  countries: string[];
  costPerDay: Array<{ currency: string; perDay: number; rentals: number; days: number }>;
  km: { total: number | null; covered: number; of: number };
}

export interface RentalSuggestions {
  trips: Array<{ id: string; name: string }>;
  roadtrips: Array<{
    id: string;
    name: string;
    vehicle: string | null;
    vehicleName: string | null;
    hasRental: boolean;
  }>;
}

export interface StationOffer {
  first: { name: string; lat: number; lon: number };
  last: { name: string; lat: number; lon: number };
}

export interface InvoiceReminder {
  rentalId: string;
  provider: string;
  confirmationNumber: string | null;
  returnStationName: string;
  returnedAt: TimeValue;
  reason: "invoiceMissing";
}

export const rentalLinksApi = {
  async stats(year?: number): Promise<RentalStats> {
    const res = await api.get<Envelope<RentalStats>>("/rentals/stats", {
      params: year ? { year } : {},
    });
    return res.data.data;
  },

  async suggestions(id: string): Promise<RentalSuggestions> {
    const res = await api.get<Envelope<RentalSuggestions>>(
      `/rentals/${encodeURIComponent(id)}/suggestions`
    );
    return res.data.data;
  },

  /** Confirms (or with null removes) the roadtrip this car was driven on. */
  async setRoadtrip(
    id: string,
    routeId: string | null
  ): Promise<{ rental: RentalBooking; stationOffer: StationOffer | null }> {
    const res = await api.post<
      Envelope<RentalBooking> & { meta: { stationOffer: StationOffer | null } }
    >(`/rentals/${encodeURIComponent(id)}/roadtrip`, { routeId });
    return { rental: res.data.data, stationOffer: res.data.meta.stationOffer };
  },

  async invoiceReminders(): Promise<InvoiceReminder[]> {
    const res = await api.get<Envelope<InvoiceReminder[]>>("/rentals/invoice-reminders");
    return res.data.data;
  },
};
