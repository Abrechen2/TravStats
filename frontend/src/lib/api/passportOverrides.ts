import { api } from "./client";
import type { CountryOverrideVerdict } from "../../types/passport";

/**
 * The user's own verdicts on passport countries (`/api/v1/passport/overrides`,
 * forgejo#308). Enveloped (`{success, data}`, ADR 0001). A failure is thrown
 * as the axios error; `overrideErrorKey` turns its code into the sentence the
 * user sees.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export interface CountryOverrideRecord {
  countryCode: string;
  verdict: CountryOverrideVerdict;
  note: string;
  day: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CountryOverrideList {
  overrides: CountryOverrideRecord[];
  /** The ISO codes a write accepts — what the country picker offers. */
  knownCountries: string[];
}

export interface CountryOverrideInput {
  verdict: CountryOverrideVerdict;
  note: string;
  day: string | null;
}

const path = (code: string): string => `/passport/overrides/${encodeURIComponent(code)}`;

export const passportOverridesApi = {
  list: async (): Promise<CountryOverrideList> => {
    const { data } = await api.get<Envelope<CountryOverrideList>>("/passport/overrides");
    return data.data;
  },
  save: async (code: string, input: CountryOverrideInput): Promise<CountryOverrideRecord> => {
    const { data } = await api.put<Envelope<CountryOverrideRecord>>(path(code), input);
    return data.data;
  },
  remove: async (code: string): Promise<void> => {
    await api.delete(path(code));
  },
};
