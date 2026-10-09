/**
 * The rental sheet (forgejo#267) — one row per rental contract, column A the
 * id, like every other sheet; read back by
 * `backend/src/services/xlsxImport/rentals.ts`.
 *
 * Every time is written on its STATION's clock, as a date cell whose UTC
 * fields ARE that wall clock (Excel has no zones — the rail sheet's rule),
 * with two companions per time so a round trip loses nothing: its precision
 * (`day` = only the day is known, never a midnight) and, for the hour that
 * happens twice on the autumn night, which occurrence (`later`).
 *
 * Unknown stays unknown: an empty price, odometer, km or time cell is null,
 * never 0. A deposit is held money, written in its own columns and currency.
 * The trip and the roadtrip travel as "Name [id]" references.
 */

import type { RentalBooking } from "../../types/rental";
import type { TimeValue } from "../../shared/time";
import { foldOf } from "../../components/rental/rentalFormTimes";
import { refCell, type ColumnSpec, type SheetSpec } from "./sheetSpec";

type T = (key: string) => string;
type Col = ColumnSpec<RentalBooking>;

/** A station wall clock as a Date whose UTC fields ARE that clock. */
function stationClockCell(value: TimeValue | null): Date | null {
  if (!value) return null;
  return new Date(`${value.local.slice(0, 16)}:00.000Z`);
}

type TimeEnd = "pickup" | "return" | "actualPickup" | "actualReturn";

export function rentalSheet(t: T): SheetSpec<RentalBooking> {
  const header = (key: string): string => t(`xlsx:columns.rental.${key}`);
  const text = (key: keyof RentalBooking & string, width = 16): Col => ({
    key,
    header: header(key),
    kind: "text",
    width,
    value: (r) => (r[key] as string | null) ?? null,
  });
  const number = (key: keyof RentalBooking & string, width = 12): Col => ({
    key,
    header: header(key),
    kind: "number",
    width,
    value: (r) => (r[key] as number | null) ?? null,
  });
  const time = (end: TimeEnd): Col[] => [
    {
      key: `${end}Local`,
      header: header(`${end}Local`),
      kind: "datetime",
      width: 18,
      value: (r) => stationClockCell(r.times[end]),
    },
    {
      key: `${end}Precision`,
      header: header(`${end}Precision`),
      kind: "text",
      width: 10,
      value: (r) => r.times[end]?.precision ?? null,
    },
    {
      key: `${end}Fold`,
      header: header(`${end}Fold`),
      kind: "text",
      width: 8,
      // Only the second occurrence needs saying; the earlier is the default.
      value: (r) => (foldOf(r.times[end]) === "later" ? "later" : null),
    },
  ];
  const station = (end: "pickup" | "return"): Col[] => [
    text(`${end}StationName`, 26),
    text(`${end}Iata`, 8),
    text(`${end}Address`, 28),
    number(`${end}Lat`, 11),
    number(`${end}Lon`, 11),
    text(`${end}Country`, 8),
  ];
  return {
    key: "rental",
    name: t("xlsx:sheets.rental"),
    hint: t("xlsx:hints.rental"),
    columns: [
      {
        key: "id",
        header: t("xlsx:columns.id"),
        kind: "text",
        width: 38,
        locked: true,
        value: (r) => r.id,
      },
      text("provider", 16),
      text("operatedBy"),
      text("broker"),
      text("confirmationNumber", 16),
      text("brokerReference"),
      text("agreementNumber"),
      text("invoiceNumber"),
      ...station("pickup"),
      ...station("return"),
      ...time("pickup"),
      ...time("return"),
      ...time("actualPickup"),
      ...time("actualReturn"),
      text("status", 12),
      text("vehicleClass"),
      text("acrissCode", 8),
      text("vehicleExample"),
      text("vehicleDriven"),
      text("licensePlate", 12),
      number("odometerOutKm"),
      number("odometerInKm"),
      number("distanceKm", 10),
      // Where the km came from travels with them: an invoice's figure and a
      // hand correction are not the same claim.
      text("distanceSource", 10),
      text("mileagePolicy", 12),
      number("mileageCapKm", 10),
      text("fuelPolicy", 14),
      text("paymentTiming", 14),
      number("price"),
      text("currency", 8),
      number("finalAmount"),
      text("finalCurrency", 8),
      text("finalAmountSource", 14),
      number("depositAmount"),
      text("depositCurrency", 8),
      {
        key: "depositPaidOn",
        header: header("depositPaidOn"),
        kind: "date",
        width: 14,
        value: (r) => r.depositPaidOn,
      },
      {
        key: "depositReturnedOn",
        header: header("depositReturnedOn"),
        kind: "date",
        width: 14,
        value: (r) => r.depositReturnedOn,
      },
      number("depositReturnedAmount"),
      {
        key: "inclusions",
        header: header("inclusions"),
        kind: "text",
        width: 24,
        value: (r) => r.inclusions.join(", "),
      },
      text("arrivalFlightNumber", 10),
      {
        key: "tripId",
        header: t("xlsx:columns.trip"),
        kind: "text",
        width: 28,
        reference: true,
        value: (r) => refCell(r.trip?.name, r.tripId),
      },
      {
        key: "routeId",
        header: t("xlsx:columns.roadtrip"),
        kind: "text",
        width: 28,
        reference: true,
        value: (r) => refCell(r.route?.name, r.routeId),
      },
      {
        key: "companions",
        header: t("xlsx:columns.companions"),
        kind: "text",
        width: 24,
        value: (r) => r.companions.join(", "),
      },
      {
        key: "tags",
        header: t("xlsx:columns.tags"),
        kind: "text",
        width: 20,
        value: (r) => r.tags.join(", "),
      },
      {
        key: "notes",
        header: t("xlsx:columns.notes"),
        kind: "text",
        width: 40,
        value: (r) => r.notes,
      },
    ],
  };
}
