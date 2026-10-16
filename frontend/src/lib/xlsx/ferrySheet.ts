/**
 * The ferry sheet — one row per crossing, column A the id, like every other
 * sheet; read back by `backend/src/services/xlsxImport/ferry.ts` where ferry
 * is visible (`importClient.importableSpecs`).
 *
 * The bus sheet's rules, because a crossing carries the same columns for its
 * two ports: times on the PORT's clock (Excel has no zones, so the wall clock
 * is handed over as one), and each port travels with its position — a port has
 * no catalogue, so a crossing without coordinates could not be placed on the
 * way back. The link to a roadtrip leg is not a column: it is not the
 * crossing's own data, and the importer never touches it.
 */

import type { FerryJourney } from "../../types/ferry";
import { railArrival, railDeparture } from "../entityTimes";
import { terminalClockCell } from "./busSheet";
import { refCell, type SheetSpec } from "./sheetSpec";

type T = (key: string) => string;

export function ferrySheet(t: T): SheetSpec<FerryJourney> {
  const text = (
    key: string,
    header: string,
    width: number,
    value: (r: FerryJourney) => string | null
  ) => ({ key, header: t(`xlsx:columns.${header}`), kind: "text" as const, width, value });
  const number = (
    key: string,
    header: string,
    width: number,
    value: (r: FerryJourney) => number | null
  ) => ({ key, header: t(`xlsx:columns.${header}`), kind: "number" as const, width, value });
  return {
    key: "ferry",
    name: t("xlsx:sheets.ferry"),
    hint: t("xlsx:hints.ferry"),
    columns: [
      {
        key: "id",
        header: t("xlsx:columns.id"),
        kind: "text",
        width: 38,
        locked: true,
        value: (r) => r.id,
      },
      text("operator", "ferry.operator", 20, (r) => r.operator),
      text("vesselName", "ferry.vesselName", 20, (r) => r.vesselName),
      text("depStationName", "ferry.fromPort", 24, (r) => r.depStationName),
      text("depAddress", "ferry.fromAddress", 24, (r) => r.depAddress),
      number("depLat", "fromLat", 11, (r) => r.depLat),
      number("depLon", "fromLon", 11, (r) => r.depLon),
      text("depCountry", "ferry.fromCountry", 8, (r) => r.depCountry),
      text("arrStationName", "ferry.toPort", 24, (r) => r.arrStationName),
      text("arrAddress", "ferry.toAddress", 24, (r) => r.arrAddress),
      number("arrLat", "toLat", 11, (r) => r.arrLat),
      number("arrLon", "toLon", 11, (r) => r.arrLon),
      text("arrCountry", "ferry.toCountry", 8, (r) => r.arrCountry),
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
      text("distanceSource", "distanceSource", 14, (r) => r.distanceSource),
      number("delayMinutes", "delayMinutes", 10, (r) => r.delayMinutes),
      text("vehicleType", "ferry.vehicleType", 14, (r) => r.vehicleType),
      text("vehicleRegistration", "ferry.vehicleRegistration", 14, (r) => r.vehicleRegistration),
      number("passengerCount", "ferry.passengerCount", 10, (r) => r.passengerCount),
      text("cabinType", "ferry.cabinType", 16, (r) => r.cabinType),
      text("fareClass", "ferry.fareClass", 10, (r) => r.fareClass),
      text("seat", "seat", 8, (r) => r.seat),
      number("price", "price", 12, (r) => r.price),
      text("currency", "currency", 10, (r) => r.currency),
      text("bookingReference", "bookingReference", 16, (r) => r.bookingReference),
      text("ticketReference", "ferry.ticketReference", 16, (r) => r.ticketReference),
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
