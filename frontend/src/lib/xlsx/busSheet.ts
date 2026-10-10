/**
 * The bus sheet (forgejo#180) — one row per bus ride, column A the id, like
 * every other sheet; read back by `backend/src/services/xlsxImport/bus.ts`
 * where bus is visible (`importClient.importableSpecs`).
 *
 * The rail sheet's rules, because a bus row carries rail's columns: times on
 * the TERMINAL's clock (Excel has no zones, so the wall clock is handed over
 * as one), and each terminal travels with its position — a coach stop has no
 * catalogue, so a ride without coordinates could not be placed on the way back.
 */

import type { BusJourney } from "../../types/bus";
import { toStationWallClock } from "../railTime";
import { railArrival, railDeparture } from "../entityTimes";
import type { TimeValue } from "../../shared/time";
import { refCell, type SheetSpec } from "./sheetSpec";

type T = (key: string) => string;

/** A terminal wall clock as a Date whose UTC fields ARE that clock. */
function terminalClockCell(value: TimeValue | null): Date | null {
  const wall = toStationWallClock(value);
  return wall ? new Date(`${wall}:00.000Z`) : null;
}

export function busSheet(t: T): SheetSpec<BusJourney> {
  const text = (
    key: string,
    header: string,
    width: number,
    value: (r: BusJourney) => string | null
  ) => ({ key, header: t(`xlsx:columns.${header}`), kind: "text" as const, width, value });
  const coordinate = (key: string, header: string, value: (r: BusJourney) => number) => ({
    key,
    header: t(`xlsx:columns.${header}`),
    kind: "number" as const,
    width: 11,
    value,
  });
  return {
    key: "bus",
    name: t("xlsx:sheets.bus"),
    hint: t("xlsx:hints.bus"),
    columns: [
      {
        key: "id",
        header: t("xlsx:columns.id"),
        kind: "text",
        width: 38,
        locked: true,
        value: (r) => r.id,
      },
      text("operator", "bus.operator", 20, (r) => r.operator),
      text("lineName", "bus.lineName", 12, (r) => r.lineName),
      text("rideKind", "bus.rideKind", 10, (r) => r.rideKind),
      text("depStationName", "bus.fromTerminal", 24, (r) => r.depStationName),
      text("depAddress", "bus.fromAddress", 24, (r) => r.depAddress),
      coordinate("depLat", "fromLat", (r) => r.depLat),
      coordinate("depLon", "fromLon", (r) => r.depLon),
      text("depCountry", "bus.fromCountry", 8, (r) => r.depCountry),
      text("arrStationName", "bus.toTerminal", 24, (r) => r.arrStationName),
      text("arrAddress", "bus.toAddress", 24, (r) => r.arrAddress),
      coordinate("arrLat", "toLat", (r) => r.arrLat),
      coordinate("arrLon", "toLon", (r) => r.arrLon),
      text("arrCountry", "bus.toCountry", 8, (r) => r.arrCountry),
      {
        key: "departureTime",
        header: t("xlsx:columns.departureLocal"),
        kind: "datetime",
        width: 18,
        value: (r) => terminalClockCell(railDeparture(r)),
      },
      {
        key: "arrivalTime",
        header: t("xlsx:columns.arrivalLocal"),
        kind: "datetime",
        width: 18,
        value: (r) => terminalClockCell(railArrival(r)),
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
      // A great-circle figure understates the road; the file says which it is.
      text("distanceSource", "distanceSource", 14, (r) => r.distanceSource),
      {
        key: "delayMinutes",
        header: t("xlsx:columns.delayMinutes"),
        kind: "number",
        width: 10,
        value: (r) => r.delayMinutes,
      },
      text("fareClass", "bus.fareClass", 10, (r) => r.fareClass),
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
