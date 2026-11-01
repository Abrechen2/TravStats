import { api } from "./client";

/**
 * `GET /<domain>/entry-suggestions` for ferry, rental, cruises and places
 * (forgejo#405): what a form can offer from the user's own earlier rows.
 * Enveloped. Offered, never written — a chip fills a field only when clicked.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface FerryEntrySuggestions {
  operators: string[];
  vessels: string[];
  fareClasses: string[];
  cabinTypes: string[];
  terminals: Array<{
    name: string;
    address: string | null;
    lat: number;
    lon: number;
    country: string | null;
  }>;
}
export interface RentalEntrySuggestions {
  providers: string[];
  brokers: string[];
  vehicleClasses: string[];
  vehicleExamples: string[];
}
export interface CruiseEntrySuggestions {
  cruiseLines: string[];
  routeNames: string[];
}
export interface PlaceEntrySuggestions {
  cities: Array<{ city: string; country: string | null; isoCountryCode: string | null }>;
  countries: Array<{ country: string; isoCountryCode: string | null }>;
}

export const NO_FERRY_SUGGESTIONS: FerryEntrySuggestions = {
  operators: [],
  vessels: [],
  fareClasses: [],
  cabinTypes: [],
  terminals: [],
};
export const NO_RENTAL_SUGGESTIONS: RentalEntrySuggestions = {
  providers: [],
  brokers: [],
  vehicleClasses: [],
  vehicleExamples: [],
};
export const NO_CRUISE_SUGGESTIONS: CruiseEntrySuggestions = { cruiseLines: [], routeNames: [] };
export const NO_PLACE_SUGGESTIONS: PlaceEntrySuggestions = { cities: [], countries: [] };

async function read<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await api.get<Envelope<T>>(path, { params });
  return res.data.data;
}

export const entrySuggestionsApi = {
  ferry: (q: { depName?: string; arrName?: string; operator?: string }) =>
    read<FerryEntrySuggestions>("/ferry/entry-suggestions", q),
  rental: (q: { provider?: string }) =>
    read<RentalEntrySuggestions>("/rentals/entry-suggestions", q),
  cruise: (q: { cruiseLine?: string }) =>
    read<CruiseEntrySuggestions>("/cruises/entry-suggestions", q),
  place: (q: { city?: string; country?: string }) =>
    read<PlaceEntrySuggestions>("/places/entry-suggestions", q),
};
