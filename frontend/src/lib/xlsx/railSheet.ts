/**
 * The rail sheet (spec 2026-09-25-rail-domain, phase 2b) — one row per train
 * ride, column A the id, like every other sheet.
 *
 * Kept out of `sheets.ts` because that file is near the 800-line limit, not
 * because it follows other rules: the same `SheetSpec`, the same "Name [id]"
 * reference for the trip.
 *
 * Times are written on the STATION's clock, the time printed on the ticket
 * (`lib/railTime.ts`). Excel has no time zones and reads a date cell as a bare
 * wall clock, so the station's wall clock is handed over as that — writing the
 * UTC instant would put a Vienna departure an hour or two off in every cell.
 *
 * Export-only for now: the importer on this branch does not read the sheet
 * (`importClient.importableSpecs`), and the sheet's hint says so. Rail import
 * follows once the reworked importer from main is merged into this branch.
 */

import type { RailJourney } from "../../types/rail";
import { toStationWallClock } from "../railTime";
import { refCell, type SheetSpec } from "./sheetSpec";

type T = (key: string) => string;

/** A station wall clock as a Date whose UTC fields ARE that clock — see above. */
function stationClockCell(iso: string | null, timeZone: string | null): Date | null {
  const wall = toStationWallClock(iso, timeZone);
  return wall ? new Date(`${wall}:00.000Z`) : null;
}

export function railSheet(t: T): SheetSpec<RailJourney> {
  const text = (
    key: string,
    header: string,
    width: number,
    value: (r: RailJourney) => string | null
  ) => ({ key, header: t(`xlsx:columns.${header}`), kind: "text" as const, width, value });
  return {
    key: "rail",
    name: t("xlsx:sheets.rail"),
    hint: t("xlsx:hints.rail"),
    columns: [
      {
        key: "id",
        header: t("xlsx:columns.id"),
        kind: "text",
        width: 38,
        locked: true,
        value: (r) => r.id,
      },
      text("operator", "operator", 20, (r) => r.operator),
      text("trainCategory", "trainCategory", 10, (r) => r.trainCategory),
      text("trainNumber", "trainNumber", 10, (r) => r.trainNumber),
      text("depStationName", "fromStation", 24, (r) => r.depStationName),
      text("depStationCode", "fromStationCode", 12, (r) => r.depStationCode),
      text("arrStationName", "toStation", 24, (r) => r.arrStationName),
      text("arrStationCode", "toStationCode", 12, (r) => r.arrStationCode),
      {
        key: "departureTime",
        header: t("xlsx:columns.departureLocal"),
        kind: "datetime",
        width: 18,
        value: (r) => stationClockCell(r.departureTime, r.depTimezone),
      },
      {
        key: "arrivalTime",
        header: t("xlsx:columns.arrivalLocal"),
        kind: "datetime",
        width: 18,
        value: (r) => stationClockCell(r.arrivalTime, r.arrTimezone),
      },
      text("status", "status", 12, (r) => r.status),
      {
        key: "distanceKm",
        header: t("xlsx:columns.distanceKm"),
        kind: "number",
        width: 10,
        locked: true,
        value: (r) => (r.distanceKm === null ? null : Math.round(r.distanceKm)),
      },
      // What the distance measures travels with it: a straight-line figure
      // understates the track, and a reader of the file should see which is which.
      text("distanceSource", "distanceSource", 14, (r) => r.distanceSource),
      {
        key: "delayMinutes",
        header: t("xlsx:columns.delayMinutes"),
        kind: "number",
        width: 10,
        value: (r) => r.delayMinutes,
      },
      text("travelClass", "travelClass", 8, (r) => r.travelClass),
      text("coach", "coach", 8, (r) => r.coach),
      text("seat", "seat", 8, (r) => r.seat),
      {
        key: "price",
        header: t("xlsx:columns.price"),
        kind: "number",
        width: 12,
        value: (r) => r.price,
      },
      text("currency", "currency", 10, (r) => r.currency),
      text("bookingReference", "bookingReference", 16, (r) => r.bookingReference),
      {
        key: "tripId",
        header: t("xlsx:columns.trip"),
        kind: "text",
        width: 28,
        reference: true,
        value: (r) => refCell(r.trip?.name, r.tripId),
      },
      text("companions", "companions", 24, (r) => r.companions.join(", ")),
      text("tags", "tags", 20, (r) => r.tags.join(", ")),
      text("notes", "notes", 40, (r) => r.notes),
    ],
  };
}
