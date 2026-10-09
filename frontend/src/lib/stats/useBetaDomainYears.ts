import { useEffect, useState } from "react";

import { rentalLinksApi } from "../api/rentalLinks";
import { busApi } from "../api/bus";
import { logger } from "../logger";
import { useRentalVisible } from "../../hooks/useRentalVisible";
import { useBusVisible } from "../../hooks/useBusVisible";

/**
 * The years rentals and bus rides hold (forgejo#265: a year picker must exist
 * for an account whose only data is rentals). The statistics page builds its
 * year list from the cross-domain adapters, which rental and bus deliberately
 * stay out of (rental spec §11 D3; the overview's `StatsDomain`), so without
 * this a rental-only account had a rental tab and no year to pick.
 *
 * Asked only for a domain the reader sees — a hidden domain contributes no
 * year, exactly as the server's year in review does. A failed load contributes
 * none either and is logged; the page still has every other domain's years.
 */
export function useBetaDomainYears(): number[] {
  const rentalVisible = useRentalVisible();
  const busVisible = useBusVisible();
  const [years, setYears] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [rental, bus] = await Promise.all([
        rentalVisible
          ? rentalLinksApi.stats().catch((err: unknown) => {
              logger.error("useBetaDomainYears: rental years failed", err);
              return null;
            })
          : Promise.resolve(null),
        busVisible
          ? busApi.stats(null).catch((err: unknown) => {
              logger.error("useBetaDomainYears: bus years failed", err);
              return null;
            })
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setYears(
        [
          ...new Set([
            ...(rental?.byYear ?? []).map((y) => y.year),
            ...(bus?.byYear ?? []).map((y) => y.year),
          ]),
        ].sort((a, b) => a - b)
      );
    })();
    return (): void => {
      cancelled = true;
    };
  }, [rentalVisible, busVisible]);

  return years;
}

/** Two ascending year lists as one, without duplicates. */
export function mergeYears(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}
