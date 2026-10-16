import i18next from "i18next";
import { useEffect, useSyncExternalStore } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { logger } from "../../lib/logger";
import { usesOwnGeoServer } from "../../lib/ownGeoServer";
import { useToastStore } from "../../store/toastStore";
import { buildRasterStyle, resolveFlatStyle, type FlatStyleId } from "./basemapStyles";

/**
 * Every vector basemap comes from one provider (OpenFreeMap by default). When
 * its style did not load, every map stayed blank and nothing said why. A style
 * that fails its probe is replaced, once per session, by a key-free raster
 * look-alike from CARTO — the provider the app used before OpenFreeMap — and a
 * notice says so. An own map server never falls back to a third party.
 */
const CARTO_ATTRIBUTION =
  "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors &copy; <a href='https://carto.com/attributions'>CARTO</a>";
const carto = (layer: string): StyleSpecification =>
  buildRasterStyle(
    ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${layer}/{z}/{x}/{y}.png`),
    CARTO_ATTRIBUTION,
    20
  );
const RASTER_FALLBACKS: Partial<Record<FlatStyleId, StyleSpecification>> = {
  standard: carto("rastertiles/voyager"),
  light: carto("light_all"),
  dark: carto("dark_all"),
  voyager: carto("rastertiles/voyager"),
};
const NOTICE_MS = 10_000;

export function rasterFallbackFor(id: FlatStyleId): StyleSpecification | null {
  return RASTER_FALLBACKS[id] ?? null;
}

const failed = new Set<string>();
const settled = new Set<string>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let epoch = 0;
let announced = false;
// Component tests render maps without a network; the probe has its own tests.
let probing = import.meta.env.MODE !== "test";

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  if (announced) return;
  announced = true;
  const key = usesOwnGeoServer() ? "map:styleFallback.unavailable" : "map:styleFallback.notice";
  useToastStore.getState().addToast("warning", i18next.t(key), NOTICE_MS);
}

/** Fetch a style document once; a failure switches its maps to the fallback. */
export async function probeStyle(url: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (settled.has(url) || inFlight.has(url)) return;
  inFlight.add(url);
  let reason: string | null = null;
  try {
    const sameOrigin = url.startsWith("/");
    const response = await fetcher(url, { credentials: sameOrigin ? "same-origin" : "omit" });
    if (!response.ok) reason = `status ${response.status}`;
    else if (((await response.json()) as { version?: unknown } | null)?.version !== 8)
      reason = "not a style document";
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  } finally {
    inFlight.delete(url);
  }
  settled.add(url);
  if (reason === null) return;
  logger.warn("Basemap style failed to load; using the fallback", { url, reason });
  failed.add(url);
  epoch++;
  listeners.forEach((listener) => listener());
  announce();
}

/** The style a map should show now: the configured one, or its fallback. */
export function resilientStyle(id: FlatStyleId): string | StyleSpecification {
  const primary = resolveFlatStyle(id);
  if (typeof primary !== "string" || !failed.has(primary) || usesOwnGeoServer()) return primary;
  return rasterFallbackFor(id) ?? primary;
}

export function useResilientStyle(id: FlatStyleId): string | StyleSpecification {
  useSyncExternalStore(
    subscribe,
    () => epoch,
    () => 0
  );
  const primary = resolveFlatStyle(id);
  useEffect(() => {
    if (probing && typeof primary === "string") void probeStyle(primary);
  }, [primary]);
  return resilientStyle(id);
}

/** Tests only: forget every probe and notice. */
export function resetStyleHealth(enableProbing = false): void {
  failed.clear();
  settled.clear();
  inFlight.clear();
  epoch = 0;
  announced = false;
  probing = enableProbing;
}
