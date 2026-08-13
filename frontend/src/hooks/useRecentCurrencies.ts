import { useEffect, useState } from "react";
import { api } from "../lib/api/client";

/**
 * The currencies this account actually books in, most-used first.
 *
 * Fetched once per page load and shared by every picker — the list changes
 * when a stay is saved, not while one is being typed, so a request per
 * keystroke (or per mounted picker) would be pure noise. An empty answer is a
 * fine answer: `CurrencySelect` then seeds its short list from the ECB set.
 */
let cache: string[] | null = null;
let inFlight: Promise<string[]> | null = null;

async function load(): Promise<string[]> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = api
      .get<{ codes: string[] }>("/currencies/recent")
      .then((res) => {
        cache = res.data.codes ?? [];
        return cache;
      })
      .catch(() => [])
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Reset between tests, or after a write that could change the ranking. */
export function clearRecentCurrenciesCache(): void {
  cache = null;
}

export function useRecentCurrencies(): string[] {
  const [codes, setCodes] = useState<string[]>(cache ?? []);

  useEffect(() => {
    let active = true;
    void load().then((list) => {
      if (active) setCodes(list);
    });
    return () => {
      active = false;
    };
  }, []);

  return codes;
}
