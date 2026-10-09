import type { Prisma } from "../../prisma";
import type { UpdateRentalInput } from "../../schemas/rental";
import { fromDbDate } from "../../shared/time/localDate";
import type { RentalState } from "./rentalWrite";

/**
 * What a write actually CHANGED, as opposed to what it sent (owner ruling,
 * review fix round 2: the server is authoritative). A form or the Companion
 * re-sends the whole record; a value re-sent as it is stored is no edit. So
 * it is not recorded as typed by hand (`userEditedFields` — which keeps a
 * later mail from updating it and turns the booked price's origin into
 * "von Hand"), it does not relabel a figure's source (`distanceSource`,
 * `finalAmountSource`), and it re-derives nothing (FX snapshots).
 *
 * Values are compared the way the columns store them: "" and null are the
 * same empty, days as `YYYY-MM-DD`, lists in order. The clocks and stations
 * are compared on the MERGED row — the instant, precision and place the write
 * leaves — because a wall clock and the stored instant are not the same text.
 * A fold key travels with its clock.
 */

type Stored = Prisma.RentalBookingGetPayload<object>;

/** Inputs that write a column of the same name. */
const PLAIN_KEYS = [
  "provider",
  "operatedBy",
  "broker",
  "confirmationNumber",
  "brokerReference",
  "agreementNumber",
  "invoiceNumber",
  "vehicleClass",
  "acrissCode",
  "vehicleExample",
  "vehicleDriven",
  "licensePlate",
  "distanceKm",
  "odometerOutKm",
  "odometerInKm",
  "mileagePolicy",
  "mileageCapKm",
  "fuelPolicy",
  "paymentTiming",
  "price",
  "currency",
  "finalAmount",
  "finalCurrency",
  "depositAmount",
  "depositCurrency",
  "depositReturnedAmount",
  "inclusions",
  "arrivalFlightNumber",
  "notes",
  "tags",
  "companions",
  "tripId",
  "routeId",
] as const satisfies ReadonlyArray<keyof UpdateRentalInput & keyof Stored>;

const DAY_KEYS = ["depositPaidOn", "depositReturnedOn"] as const;

const empty = (v: unknown): unknown => (v === undefined || v === null || v === "" ? null : v);

function same(sent: unknown, stored: unknown): boolean {
  const a = empty(sent);
  const b = empty(stored);
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  return a === b;
}

const at = (d: Date | null): number | null => (d ? d.getTime() : null);

function stationMoved(state: RentalState, stored: Stored, end: "pickup" | "return"): boolean {
  const keys = [
    "StationName",
    "Address",
    "AirportId",
    "Lat",
    "Lon",
    "Country",
    "Timezone",
  ] as const;
  return keys.some(
    (k) => !same(state[`${end}${k}` as keyof RentalState], stored[`${end}${k}` as keyof Stored])
  );
}

/** `input` without the keys whose value the stored row already holds. */
export function changedInput(
  stored: Stored,
  input: UpdateRentalInput,
  state: RentalState
): UpdateRentalInput {
  const out: Record<string, unknown> = { ...input };
  const drop = (...keys: string[]): void => keys.forEach((k) => delete out[k]);

  for (const key of PLAIN_KEYS) {
    if (key in input && same(input[key], stored[key])) drop(key);
  }
  for (const key of DAY_KEYS) {
    const day = stored[key] ? fromDbDate(stored[key] as Date) : null;
    if (key in input && same(input[key], day)) drop(key);
  }
  if (
    input.status !== undefined &&
    (input.status === "cancelled") === (stored.status === "cancelled")
  ) {
    drop("status");
  }
  const clocks = [
    ["pickup", state.pickupTime, state.pickupPrecision, stored.pickupTime, stored.pickupPrecision],
    ["return", state.returnTime, state.returnPrecision, stored.returnTime, stored.returnPrecision],
    [
      "actualPickup",
      state.actualPickupTime,
      state.actualPickupPrecision,
      stored.actualPickupTime,
      stored.actualPickupPrecision ?? (stored.actualPickupTime ? "minute" : null),
    ],
    [
      "actualReturn",
      state.actualReturnTime,
      state.actualReturnPrecision,
      stored.actualReturnTime,
      stored.actualReturnPrecision ?? (stored.actualReturnTime ? "minute" : null),
    ],
  ] as const;
  for (const [end, time, precision, storedTime, storedPrecision] of clocks) {
    if (`${end}Local` in input && at(time) === at(storedTime) && same(precision, storedPrecision)) {
      drop(`${end}Local`, `${end}Fold`);
    }
  }
  if ("pickupStation" in input && !stationMoved(state, stored, "pickup")) drop("pickupStation");
  if ("returnStation" in input && !stationMoved(state, stored, "return")) drop("returnStation");
  return out as UpdateRentalInput;
}
