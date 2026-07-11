import { useEffect, useState } from "react";
import { getFxPreview } from "../lib/api/lodging";
import { logger } from "../lib/logger";
import type { FxPreview } from "../types/lodging";

const DEBOUNCE_MS = 400;

interface UseLodgingFxPreviewParams {
  /** Parsed total price, or `null` while the field is empty/invalid. */
  totalPrice: number | null;
  currency: string;
  /** Check-in as "YYYY-MM-DD", or "" while unset. */
  checkInDate: string;
  baseCurrency: string;
}

/**
 * Live, debounced FX-readout preview for the stay editor — a read-only GET
 * against `/lodging/fx-preview` (a same-origin proxy the backend exposes
 * specifically so the browser never needs to call the external Frankfurter
 * API directly, which the app's CSP `connect-src 'self'` would block anyway).
 *
 * This is DISPLAY ONLY. The authoritative conversion is computed and stored
 * server-side at save time by `applyFxSnapshot` (routes/lodging.ts) — this
 * hook's result is never sent back to the server. Returns `null` whenever
 * price/currency/checkIn aren't all set, the currency already equals the
 * base currency, or the lookup fails — every one of those cases must render
 * nothing, never a stale or guessed number.
 */
export function useLodgingFxPreview({
  totalPrice,
  currency,
  checkInDate,
  baseCurrency,
}: UseLodgingFxPreviewParams): FxPreview | null {
  const [preview, setPreview] = useState<FxPreview | null>(null);

  useEffect(() => {
    if (totalPrice === null || totalPrice <= 0 || checkInDate === "" || currency === baseCurrency) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const result = await getFxPreview(totalPrice, currency, checkInDate);
          if (!cancelled) setPreview(result);
        } catch (err: unknown) {
          logger.warn("useLodgingFxPreview: preview lookup failed", err);
          if (!cancelled) setPreview(null);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [totalPrice, currency, checkInDate, baseCurrency]);

  return preview;
}
