import { useEffect, useState } from "react";
import { rentalApi } from "../../lib/api/rental";
import { logger } from "../../lib/logger";

/**
 * Common rental and car-sharing companies, offered as SUGGESTIONS for the
 * provider field (forgejo#196). The list is data — the server's catalogue
 * (`backend/data/rental/providers.json`, `GET /rentals/providers`), the same
 * one its logo lookup reads — not a copy kept here.
 *
 * The field stays free text: a local company, a broker's own brand or a
 * spelling the reader prefers is kept exactly as typed. A failed load is
 * logged and offers no suggestions; it never blocks the form, because the
 * suggestions only ever saved typing.
 */
let cached: readonly string[] | null = null;
let pending: Promise<readonly string[]> | null = null;

export async function loadRentalProviderSuggestions(): Promise<readonly string[]> {
  if (cached) return cached;
  pending ??= Promise.resolve()
    .then(() => rentalApi.listProviders())
    .then((providers) => {
      cached = providers.map((p) => p.name);
      return cached;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Test seam: forget the loaded list. */
export function __resetRentalProviderSuggestions(): void {
  cached = null;
  pending = null;
}

export function useRentalProviderSuggestions(): readonly string[] {
  const [names, setNames] = useState<readonly string[]>(cached ?? []);
  useEffect(() => {
    let alive = true;
    loadRentalProviderSuggestions()
      .then((list) => {
        if (alive) setNames(list);
      })
      .catch((err: unknown) => {
        logger.warn("rental provider suggestions unavailable", err);
      });
    return (): void => {
      alive = false;
    };
  }, []);
  return names;
}
