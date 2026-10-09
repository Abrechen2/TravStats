/**
 * Reading one rental row of a spreadsheet (forgejo#267) into the write body
 * the rental routes understand — pure, so the parsing is tested apart from
 * the database. The export (`frontend/src/lib/xlsx/rentalSheet.ts`) writes
 * each time as the station's wall clock with its precision and occurrence;
 * this is the other half and must agree with it.
 */

import {
  RENTAL_DISTANCE_SOURCES,
  RENTAL_FUEL_POLICIES,
  RENTAL_INCLUSIONS,
  RENTAL_MILEAGE_POLICIES,
  RENTAL_PAYMENT_TIMINGS,
  RENTAL_STATUSES,
  type CreateRentalBody,
} from "../../schemas/rental";
import * as cell from "./cells";
import { definedOnly } from "./context";
import type { DroppedValue } from "./types";
import { enumCell } from "./values";

export const RENTAL_TIME_ENDS = ["pickup", "return", "actualPickup", "actualReturn"] as const;
export type RentalTimeEnd = (typeof RENTAL_TIME_ENDS)[number];

export interface SheetTime {
  /** `YYYY-MM-DDTHH:mm`, or `YYYY-MM-DD` for a day-only end. */
  wall: string;
  fold: "earlier" | "later";
}

/**
 * One time cell with its precision and fold cells: undefined when blank,
 * "invalid" when unreadable. Without a precision cell, a cell that names no
 * clock is a day (it states the day and nothing about the hour).
 */
export function sheetTime(
  raw: Record<string, string>,
  end: RentalTimeEnd,
  dropped: DroppedValue[]
): SheetTime | undefined | "invalid" {
  const source = raw[`${end}Local`];
  const iso = cell.isoTimestamp(source);
  if (iso === undefined) return undefined;
  if (iso === null) return "invalid";
  const stated = enumCell(
    raw[`${end}Precision`],
    ["minute", "day"] as const,
    `${end}Precision`,
    dropped
  );
  const day = stated ? stated === "day" : !cell.hasClock(source);
  const fold = enumCell(raw[`${end}Fold`], ["earlier", "later"] as const, `${end}Fold`, dropped);
  return { wall: day ? iso.slice(0, 10) : iso.slice(0, 16), fold: fold ?? "earlier" };
}

export interface SheetStation {
  name?: string;
  iata?: string;
  address?: string;
  lat?: number;
  lon?: number;
  country?: string;
}

/** A station's six cells; "invalid" when a coordinate is not a number. */
export function sheetStation(
  raw: Record<string, string>,
  end: "pickup" | "return"
): SheetStation | "invalid" {
  const lat = cell.num(raw[`${end}Lat`]);
  const lon = cell.num(raw[`${end}Lon`]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return "invalid";
  return definedOnly({
    name: cell.text(raw[`${end}StationName`]),
    iata: cell.text(raw[`${end}Iata`])?.toUpperCase(),
    address: cell.text(raw[`${end}Address`]),
    lat,
    lon,
    country: cell.text(raw[`${end}Country`])?.toUpperCase(),
  });
}

/**
 * The station as the write body names it: by its airport when the sheet names
 * one (so the airport link survives a move into another account), else by the
 * position the sheet carries, else by its address.
 */
export function stationBody(s: SheetStation): CreateRentalBody["pickupStation"] | null {
  if (!s.name) return null;
  const placed = s.lat !== undefined && s.lon !== undefined;
  return {
    name: s.name,
    ...(s.iata ? { iata: s.iata } : placed ? { lat: s.lat, lon: s.lon } : {}),
    ...(s.address ? { address: s.address } : {}),
    ...(s.country ? { country: s.country } : {}),
  };
}

/** The plain cells — written as the sheet says, unknown stays unknown (absent, never 0). */
export function plainCells(raw: Record<string, string>, dropped: DroppedValue[]) {
  const inclusions = cell.list(raw.inclusions);
  const knownInclusions = inclusions?.filter((code) => {
    const hit = (RENTAL_INCLUSIONS as readonly string[]).includes(code.toLowerCase());
    if (!hit) dropped.push({ field: "inclusions", value: code });
    return hit;
  });
  return definedOnly({
    provider: cell.text(raw.provider),
    operatedBy: cell.text(raw.operatedBy),
    broker: cell.text(raw.broker),
    confirmationNumber: cell.text(raw.confirmationNumber),
    brokerReference: cell.text(raw.brokerReference),
    agreementNumber: cell.text(raw.agreementNumber),
    invoiceNumber: cell.text(raw.invoiceNumber),
    vehicleClass: cell.text(raw.vehicleClass),
    acrissCode: cell.text(raw.acrissCode)?.toUpperCase(),
    vehicleExample: cell.text(raw.vehicleExample),
    vehicleDriven: cell.text(raw.vehicleDriven),
    licensePlate: cell.text(raw.licensePlate),
    odometerOutKm: cell.int(raw.odometerOutKm),
    odometerInKm: cell.int(raw.odometerInKm),
    mileagePolicy: enumCell(raw.mileagePolicy, RENTAL_MILEAGE_POLICIES, "mileagePolicy", dropped),
    mileageCapKm: cell.int(raw.mileageCapKm),
    fuelPolicy: enumCell(raw.fuelPolicy, RENTAL_FUEL_POLICIES, "fuelPolicy", dropped),
    paymentTiming: enumCell(raw.paymentTiming, RENTAL_PAYMENT_TIMINGS, "paymentTiming", dropped),
    price: cell.num(raw.price),
    currency: cell.text(raw.currency)?.toUpperCase(),
    depositAmount: cell.num(raw.depositAmount),
    depositCurrency: cell.text(raw.depositCurrency)?.toUpperCase(),
    depositReturnedAmount: cell.num(raw.depositReturnedAmount),
    inclusions: knownInclusions?.map((c) => c.toLowerCase()),
    arrivalFlightNumber: cell.text(raw.arrivalFlightNumber),
    notes: cell.text(raw.notes),
    tags: cell.list(raw.tags),
  });
}

/** A deposit day cell: undefined blank, null unreadable. */
export const dayCell = (raw: string | undefined): string | null | undefined => cell.isoDate(raw);

export function statusCell(raw: string | undefined, dropped: DroppedValue[]) {
  return enumCell(raw, RENTAL_STATUSES, "status", dropped);
}

/** The km and where they came from, as the sheet states them. */
export function distanceCells(raw: Record<string, string>, dropped: DroppedValue[]) {
  return {
    km: cell.int(raw.distanceKm),
    source: enumCell(raw.distanceSource, RENTAL_DISTANCE_SOURCES, "distanceSource", dropped),
  };
}

export function finalCells(raw: Record<string, string>, dropped: DroppedValue[]) {
  return {
    amount: cell.num(raw.finalAmount),
    currency: cell.text(raw.finalCurrency)?.toUpperCase(),
    source: enumCell(
      raw.finalAmountSource,
      ["invoice", "user", "cancellationFee"] as const,
      "finalAmountSource",
      dropped
    ),
  };
}
