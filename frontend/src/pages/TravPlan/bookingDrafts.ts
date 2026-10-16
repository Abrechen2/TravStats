import { newPlanId } from "../../lib/travplanId";
import { newEntry } from "./editorModel";
import type { PlanBooking, PlanView } from "../../lib/api/travplan";
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const date = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(v)
    ? v.slice(0, 10)
    : null;
const clock = (v: unknown) =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
const localClock = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(v)
    ? v.slice(11, 16)
    : null;
const money = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? v
    : typeof v === "string" && /^\d+(?:[.,]\d{1,2})?$/.test(v)
      ? Number(v.replace(",", "."))
      : null;
export function bookingDrafts(body: unknown, plan: PlanView): PlanBooking[] {
  const result = record(body),
    pack = record(result.package),
    isPackage = result.domain === "package";
  const rows: { kind: string; value: unknown }[] = isPackage
    ? [
        ...(Array.isArray(pack.flights)
          ? pack.flights.map((value) => ({ kind: "flight", value }))
          : []),
        ...(Array.isArray(pack.stays) ? pack.stays.map((value) => ({ kind: "hotel", value })) : []),
        ...(pack.cruiseShip
          ? [
              {
                kind: "cruise",
                value: {
                  shipName: pack.cruiseShip,
                  startDate: pack.cruiseStart,
                  endDate: pack.cruiseEnd,
                  departurePort: pack.cruiseFrom,
                  arrivalPort: pack.cruiseTo,
                },
              },
            ]
          : []),
      ]
    : (Array.isArray(result.flights)
        ? result.flights
        : Array.isArray(result.cruises)
          ? result.cruises
          : Array.isArray(result.candidates)
            ? result.candidates
            : Array.isArray(result.bookings)
              ? result.bookings
              : []
      ).map((value) => ({
        kind: result.domain === "lodging" ? "hotel" : str(result.domain) || "flight",
        value,
      }));
  const priceGroupId = isPackage ? newPlanId() : null;
  return rows.slice(0, 100).map(({ kind, value }) => {
    const b = record(value),
      lodging = record(b.lodging),
      dep =
        b.departureLocal ??
        b.departureDate ??
        b.departureTime ??
        b.checkIn ??
        b.startDate ??
        b.date,
      arr = b.arrivalLocal ?? b.arrivalDate ?? b.arrivalTime;
    const arrivalDay =
      isPackage && typeof b.arrDayOffset === "number" && date(dep)
        ? new Date(Date.parse(date(dep)!) + b.arrDayOffset * 864e5).toISOString().slice(0, 10)
        : date(arr);
    const readAmount = money(isPackage ? pack.totalPrice : (b.totalPrice ?? b.price ?? b.amount));
    const reference =
      str(
        isPackage ? pack.bookingReference : (b.bookingReference ?? b.pnr ?? b.confirmationNumber)
      ) || null;
    // A repeated amount in a multi-leg flight reading has no declared price scope.
    const ambiguous =
      !isPackage &&
      kind === "flight" &&
      reference &&
      rows.filter((r) => {
        const x = record(r.value);
        return (
          str(x.bookingReference ?? x.pnr) === reference &&
          money(x.price ?? x.amount) === readAmount
        );
      }).length > 1;
    return {
      ...newEntry("bookings", null, plan.state.currency, null),
      priceGroupId,
      kind: ["flight", "hotel", "rail", "bus", "ferry", "cruise", "rental"].includes(kind)
        ? kind
        : "flight",
      title:
        str(b.hotelName) ||
        str(lodging.name) ||
        str(b.shipName) ||
        str(b.name) ||
        str(b.title) ||
        [
          str(b.depIata ?? b.departureCode ?? b.depStationName),
          str(b.arrIata ?? b.arrivalCode ?? b.arrStationName),
        ]
          .filter(Boolean)
          .join(" → ") ||
        plan.state.destination ||
        "Booking",
      reference,
      provider: str(isPackage ? pack.operator : (b.airline ?? b.operator ?? b.provider)),
      day: date(dep),
      endDay: date(b.checkOut ?? b.endDate ?? b.returnLocal),
      time: clock(b.depTime ?? b.departureTime) || localClock(b.departureLocal ?? b.departureTime),
      timezone: str(b.depTimezone ?? b.pickupTimezone) || null,
      amount:
        ambiguous || !/^[A-Z]{3}$/.test(str(isPackage ? pack.currency : b.currency))
          ? null
          : readAmount,
      paid: 0,
      currency: /^[A-Z]{3}$/.test(str(isPackage ? pack.currency : b.currency))
        ? str(isPackage ? pack.currency : b.currency)
        : plan.state.currency,
      place:
        str(b.city) ||
        str(lodging.city) ||
        str(b.arrIata ?? b.arrivalCode ?? b.arrStationName ?? b.arrivalPort),
      city: str(b.city ?? lodging.city),
      country: str(b.country ?? lodging.country),
      address: str(b.address ?? lodging.address),
      arrivalDay,
      arrivalTime: clock(b.arrTime ?? b.arrivalTime) || localClock(b.arrivalLocal ?? b.arrivalTime),
      arrivalTimezone: str(b.arrTimezone) || null,
      originPlace: str(b.depIata ?? b.departureCode ?? b.depStationName ?? b.departurePort),
      overnight: kind === "cruise",
      source: "document",
      documentIds: [],
      details: {
        ...b,
        ...(ambiguous ? { unqualifiedPrice: readAmount } : {}),
        ...(isPackage ? { packageTotal: true } : {}),
      },
    } as unknown as PlanBooking;
  });
}
