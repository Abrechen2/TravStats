import { useEffect, useState } from "react";
import { api } from "../lib/api/client";
import { logger } from "../lib/logger";

export interface AirlineLogoManifest {
  /** True when an admin has configured a logostream key — the premium tier. */
  readonly premium: boolean;
  /** Brand colour per IATA/ICAO code, for the airlines whose mark we vendor. */
  readonly brands: Readonly<Record<string, { color: string }>>;
}

const EMPTY: AirlineLogoManifest = { premium: false, brands: {} };

/**
 * The logo manifest, fetched once per page load and shared by every row.
 *
 * A flights table renders hundreds of logo cells; each one needs to know how to
 * frame what it is about to receive. The keyless default serves square brand
 * MARKS, so the cell paints the airline's colour behind them — but with a
 * logostream key the premium tier answers first with a WORDMARK, and the same
 * treatment would look broken. Only the server knows which tier will win, hence
 * one small manifest instead of a guess per row.
 *
 * A failure is not worth a toast: the cell simply falls back to the neutral
 * wordmark tile, which is what every instance looked like before this existed.
 */
let cached: Promise<AirlineLogoManifest> | null = null;

function load(): Promise<AirlineLogoManifest> {
  cached ??= api
    .get<AirlineLogoManifest>("/airline-logos/manifest")
    .then((res) => res.data)
    .catch((error: unknown) => {
      logger.warn("Failed to load the airline logo manifest", error);
      return EMPTY;
    });
  return cached;
}

/** Test seam: drop the module-level cache between cases. */
export function __resetAirlineLogoManifestForTests(): void {
  cached = null;
}

export function useAirlineLogoManifest(): AirlineLogoManifest {
  const [manifest, setManifest] = useState<AirlineLogoManifest>(EMPTY);

  useEffect(() => {
    let active = true;
    void load().then((value) => {
      if (active) setManifest(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return manifest;
}
