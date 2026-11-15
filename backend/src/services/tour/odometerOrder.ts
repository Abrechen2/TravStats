import { AppError } from "../../middleware/errorHandler";

type Readings = { startOdometerKm?: number | null; endOdometerKm?: number | null };

/**
 * Refuse a write that leaves a tour/roadtrip's end odometer BELOW its start
 * one (forgejo#280) — 400 `TOUR_ODOMETER_REVERSED` on `endOdometerKm`. Checked
 * on the merged row, so a PATCH of one reading is held against the stored
 * other; a write that touches neither never trips over a stored pair.
 * `undefined` = not sent (keep stored), `null` = cleared.
 */
export function assertTourOdometerOrder(existing: Readings | null, input: Readings): void {
  if (input.startOdometerKm === undefined && input.endOdometerKm === undefined) return;
  const start =
    input.startOdometerKm !== undefined
      ? input.startOdometerKm
      : (existing?.startOdometerKm ?? null);
  const end =
    input.endOdometerKm !== undefined ? input.endOdometerKm : (existing?.endOdometerKm ?? null);
  if (start !== null && end !== null && end < start) {
    throw new AppError(
      "the end odometer must not be below the start odometer",
      400,
      "TOUR_ODOMETER_REVERSED",
      "endOdometerKm"
    );
  }
}
