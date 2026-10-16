/** Materialize travel evidence only after an explicit confirmation. */
import type { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { createFlightSchema } from "../../schemas/flight";
import { buildFlightCreateData } from "../flights/flightCreateData";
import { fxColumnsFor, getBaseCurrency, type FxColumns } from "../fx/snapshot";
import { createLodgingSchema, createStaySchema } from "../../schemas/lodging";
import { buildLodgingCreateData } from "../lodging/createLodging";
import { buildStayCreateData, type StayCreateColumns } from "../lodging/stayWrites";
import type { PlanState, PlanBooking } from "./types";
import { propagateWrite, propagateDelete, shareSnapshot } from "../sharing/propagate";
export type PlanTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export interface PreparedExecution {
  flight?: Prisma.FlightUncheckedCreateInput;
  stay?: StayCreateColumns;
  lodging?: Prisma.LodgingUncheckedCreateInput;
  fx?: FxColumns;
}
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
/**
 * Every booking of a package carries the PACKAGE total (frontend bookingDrafts), shared through
 * priceGroupId. That price belongs on the one actual Booking; on a stay it counted the whole
 * holiday as hotel spend, once per hotel - the package commit leaves stays unpriced too.
 */
const sharesGroupPrice = (b: PlanBooking) => !!b.priceGroupId || b.details.packageTotal === true;
/**
 * A confirmed hotel goes through the same derivations as every other stay writer
 * (buildLodgingCreateData / buildStayCreateData, like trip/package/commit.ts). The hand-written
 * row it replaced had no check-in/-out instants, no check-out time and no coordinates.
 */
async function prepareHotel(userId: string, b: PlanBooking) {
  const checkOutTime =
    typeof b.details.checkOutTime === "string" && HH_MM.test(b.details.checkOutTime)
      ? b.details.checkOutTime
      : null;
  const priced = !sharesGroupPrice(b) && b.amount !== null;
  const stay = await buildStayCreateData(
    userId,
    b.timezone,
    createStaySchema.parse({
      checkIn: b.day,
      checkOut: b.endDay,
      checkInTime: b.day ? b.time : null,
      checkOutTime: b.endDay ? checkOutTime : null,
      datePrecision: b.day || b.endDay ? "DAY" : "NONE",
      status: "completed",
      // The Booking row keeps a longer reference in full; a stay column holds 40 characters.
      bookingReference: b.reference && b.reference.length <= 40 ? b.reference : null,
      totalPrice: priced ? b.amount : null,
      currency: b.currency,
      receiptUrl: null,
    }),
    { dataSource: "manual", origin: "machine" }
  );
  const coordinates = createLodgingSchema
    .pick({ lat: true, lon: true })
    .safeParse({ lat: b.details.lat, lon: b.details.lon });
  const lodging = await buildLodgingCreateData(
    userId,
    {
      type: "hotel",
      name: b.title,
      city: b.city || null,
      country: b.country || null,
      address: b.address || null,
      visited: true,
      ...(coordinates.success &&
      typeof coordinates.data.lat === "number" &&
      typeof coordinates.data.lon === "number"
        ? { lat: coordinates.data.lat, lon: coordinates.data.lon }
        : {}),
    },
    { dataSource: "manual" }
  );
  return { stay, lodging };
}
const refused = () =>
  new AppError("Review the actual travel record in TravStats first", 409, "PLAN_EXECUTION_EDITED");
function actualDate(booking: PlanBooking) {
  for (const [day, zone] of [
    [booking.day, booking.timezone],
    [booking.endDay, booking.timezone],
    [booking.arrivalDay, booking.arrivalTimezone],
  ] as const) {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    if (day && day > today)
      throw new AppError(
        "Future travel cannot be confirmed as experienced",
        400,
        "PLAN_EXECUTION_FUTURE"
      );
  }
}
export async function prepareExecution(
  userId: string,
  tripId: string,
  state: PlanState,
  itemId: string
): Promise<PreparedExecution> {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) throw new AppError("Plan item not found", 404, "PLAN_ITEM_NOT_FOUND");
  if (item.source?.kind.startsWith("linkedActual:")) return {};
  if (item.source?.kind.startsWith("existing:"))
    throw new AppError(
      "Confirm the corresponding record in TravStats and link it here",
      400,
      "PLAN_EXECUTION_LINK"
    );
  if (["activity", "free", "transfer"].includes(item.kind)) return {};
  if (!["flight", "hotel"].includes(item.kind))
    throw new AppError(
      "Link the corresponding actual record from TravStats",
      400,
      "PLAN_EXECUTION_LINK"
    );
  const b = state.bookings.find((x) => x.id === item.bookingId);
  if (!b) throw new AppError("Reviewed booking required", 400, "PLAN_EXECUTION_DETAILS");
  if (b.source === "existing")
    throw new AppError("Link the existing actual record", 400, "PLAN_EXECUTION_LINK");
  actualDate(b);
  const fx = await fxColumnsFor(
    {
      amount: b.amount,
      currency: b.currency,
      date: b.day ? new Date(b.day + "T00:00:00Z") : new Date(),
    },
    await getBaseCurrency(userId)
  );
  if (item.kind === "hotel") return { fx, ...(await prepareHotel(userId, b)) };
  const depCode = String(b.details.depIata ?? b.originPlace ?? "")
      .trim()
      .toUpperCase(),
    arrCode = String(b.details.arrIata ?? b.place)
      .trim()
      .toUpperCase();
  const [departure, arrival] = await Promise.all([
    prisma.airport.findFirst({ where: { iata: depCode }, orderBy: { isClosed: "asc" } }),
    prisma.airport.findFirst({ where: { iata: arrCode }, orderBy: { isClosed: "asc" } }),
  ]);
  if (!departure || !arrival)
    throw new AppError(
      "Departure and arrival airports must be known",
      400,
      "PLAN_EXECUTION_DETAILS"
    );
  const depZone = b.timezone || departure.timezone,
    arrZone = b.arrivalTimezone || arrival.timezone;
  const data = createFlightSchema.parse({
    departure: {
      iata: departure.iata,
      icao: departure.icao,
      name: departure.name,
      lat: departure.lat,
      lon: departure.lon,
    },
    arrival: {
      iata: arrival.iata,
      icao: arrival.icao,
      name: arrival.name,
      lat: arrival.lat,
      lon: arrival.lon,
    },
    ...(b.day
      ? {
          departureLocal: b.day + "T" + (b.time || "00:00"),
          depTimezone: depZone,
          ...(!b.time ? { depTimeSemantics: "DATE_ONLY" } : {}),
        }
      : {}),
    ...(b.arrivalDay
      ? {
          arrivalLocal: b.arrivalDay + "T" + (b.arrivalTime || "00:00"),
          arrTimezone: arrZone,
          ...(!b.arrivalTime ? { arrTimeSemantics: "DATE_ONLY" } : {}),
        }
      : {}),
    flightNumber: typeof b.details.flightNumber === "string" ? b.details.flightNumber : undefined,
    airline: b.provider || undefined,
    bookingReference: b.reference || undefined,
    companions: [],
    price: b.amount ?? undefined,
    currency: b.currency,
    status: "historical",
    dataSource: "manual",
    notes: item.note,
  });
  const flight = await buildFlightCreateData(data, {
    mode: "import",
    userId,
    externalRef: "travplan:" + item.id,
    importBatchId: null,
    enriched: { departure, arrival },
    companionNames: [],
    fx,
    tripId,
  });
  if (
    (b.time && flight.departureTime instanceof Date && flight.departureTime > new Date()) ||
    (b.arrivalTime && flight.arrivalTime instanceof Date && flight.arrivalTime > new Date())
  )
    throw new AppError("Future travel cannot be confirmed", 400, "PLAN_EXECUTION_FUTURE");
  return { flight, fx };
}
async function actualBooking(
  tx: PlanTransaction,
  userId: string,
  tripId: string,
  b: PlanBooking,
  fx: FxColumns,
  state: PlanState
) {
  if (b.priceGroupId && !b.actualBookingId)
    b.actualBookingId = state.bookings.find(
      (x) => x.priceGroupId === b.priceGroupId && x.actualBookingId
    )?.actualBookingId;
  if (b.actualBookingId) {
    const existing = await tx.booking.findFirst({
      where: { id: b.actualBookingId, userId, tripId },
    });
    if (existing) return existing;
    // A row that still exists elsewhere was moved by the user: a conflict to review. A row that is
    // gone was deleted by un-confirming, and undo restores a state that still names it - that
    // refusal made every undo of an un-confirmation answer 409. Book it anew instead.
    if (await tx.booking.findUnique({ where: { id: b.actualBookingId }, select: { id: true } }))
      throw refused();
    const stale = b.actualBookingId;
    for (const related of state.bookings)
      if (related.actualBookingId === stale) related.actualBookingId = null;
  }
  const created = await tx.booking.create({
    data: {
      userId,
      tripId,
      pnr: b.reference,
      price: b.amount,
      currency: b.currency,
      operator: b.provider || null,
      ...fx,
    },
  });
  b.actualBookingId = created.id;
  return created;
}
async function withdrawBooking(
  tx: PlanTransaction,
  userId: string,
  tripId: string,
  b: PlanBooking | undefined,
  version: string | undefined,
  state: PlanState
) {
  if (!b?.actualBookingId) return;
  const row = await tx.booking.findFirst({ where: { id: b.actualBookingId, userId, tripId } });
  if (!row) {
    b.actualBookingId = null;
    return;
  }
  if (version && row.updatedAt.toISOString() !== version) throw refused();
  const counts = await Promise.all([
    tx.flight.count({ where: { bookingId: row.id } }),
    tx.lodgingStay.count({ where: { bookingId: row.id } }),
    tx.cruise.count({ where: { bookingId: row.id } }),
    tx.railJourney.count({ where: { bookingId: row.id } }),
    tx.busJourney.count({ where: { bookingId: row.id } }),
    tx.ferryJourney.count({ where: { bookingId: row.id } }),
  ]);
  if (counts.every((n) => n === 0)) {
    await tx.booking.delete({ where: { id: row.id } });
    for (const related of state.bookings)
      if (related.actualBookingId === row.id) related.actualBookingId = null;
  }
}
export async function synchronizeExecution(
  tx: PlanTransaction,
  userId: string,
  tripId: string,
  before: PlanState,
  next: PlanState,
  prepared: Map<string, PreparedExecution>
) {
  for (const item of next.items) {
    if (item.source?.kind.startsWith("linkedActual:")) continue;
    const old = before.items.find((i) => i.id === item.id);
    if (old?.source?.kind.startsWith("linkedActual:")) {
      if (item.execution !== "confirmed") item.source = null;
      continue;
    }
    if (old?.execution === item.execution) continue;
    const b = next.bookings.find((x) => x.id === item.bookingId),
      ready = prepared.get(item.id);
    if (item.execution === "confirmed") {
      if (["activity", "free", "transfer"].includes(item.kind)) {
        if (!item.day) throw new AppError("An actual date is required", 400, "PLAN_EXECUTION_DATE");
        if (
          item.day >
          new Intl.DateTimeFormat("en-CA", {
            timeZone: item.timezone || "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date())
        )
          throw new AppError(
            "Future experiences cannot be confirmed",
            400,
            "PLAN_EXECUTION_FUTURE"
          );
        const date = new Date(item.day + "T00:00:00Z"),
          journal = await tx.tripJournalEntry.create({
            data: { tripId, date, day: date, title: item.title, body: item.note || item.title },
          });
        item.source = {
          kind: "planJournal",
          id: journal.id,
          version: journal.updatedAt.toISOString(),
        };
      } else if (item.kind === "flight" && ready?.flight && ready.fx && b) {
        const booking = await actualBooking(tx, userId, tripId, b, ready.fx, next),
          created = await tx.flight.create({ data: { ...ready.flight, bookingId: booking.id } });
        await propagateWrite(tx, userId, "flight", created.id);
        // Assigning a sharing key advances updatedAt. Undo must compare with
        // the completed write, rather than refusing its own bookkeeping.
        const persisted = await tx.flight.findUniqueOrThrow({
          where: { id: created.id },
          select: { updatedAt: true },
        });
        item.source = {
          kind: "planFlight",
          id: created.id,
          version: persisted.updatedAt.toISOString(),
          bookingVersion: booking.updatedAt.toISOString(),
        };
      } else if (item.kind === "hotel" && ready?.fx && ready.stay && ready.lodging && b) {
        // A name alone is not venue identity. Use only location fields exposed in booking review.
        const city = b.city || null,
          country = b.country || null,
          address = b.address || null;
        let lodging =
          city && country && address
            ? await tx.lodging.findFirst({
                where: { userId, name: b.title, city, country, address },
              })
            : null;
        let createdAux = false;
        if (!lodging) {
          lodging = await tx.lodging.create({ data: ready.lodging });
          createdAux = true;
        }
        const booking = await actualBooking(tx, userId, tripId, b, ready.fx, next),
          created = await tx.lodgingStay.create({
            data: {
              ...ready.stay,
              userId,
              tripId,
              lodgingId: lodging.id,
              bookingId: booking.id,
              externalRef: "travplan:" + item.id,
            },
          });
        await propagateWrite(tx, userId, "lodgingStay", created.id);
        const persisted = await tx.lodgingStay.findUniqueOrThrow({
          where: { id: created.id },
          select: { updatedAt: true },
        });
        item.source = {
          kind: "planHotel",
          id: created.id,
          version: persisted.updatedAt.toISOString(),
          bookingVersion: booking.updatedAt.toISOString(),
          auxId: lodging.id,
          auxVersion: lodging.updatedAt.toISOString(),
          createdAux,
        };
      } else
        throw new AppError("Link an actual transport record first", 400, "PLAN_EXECUTION_LINK");
    } else if (old?.source?.kind === "planJournal") {
      const journal = await tx.tripJournalEntry.findFirst({
        where: { id: old.source.id, tripId },
        include: { photos: true },
      });
      if (
        journal &&
        (journal.updatedAt.toISOString() !== old.source.version || journal.photos.length)
      )
        throw refused();
      await tx.tripJournalEntry.deleteMany({ where: { id: old.source.id, tripId } });
      item.source = null;
    } else if (old?.source?.kind === "planFlight") {
      const flight = await tx.flight.findFirst({
        where: { id: old.source.id, userId },
        include: { documents: true, track: true, publicShareLinks: true, companionLinks: true },
      });
      if (
        flight &&
        (flight.tripId !== tripId ||
          flight.updatedAt.toISOString() !== old.source.version ||
          flight.documents.length ||
          flight.track ||
          flight.publicShareLinks.length ||
          flight.companionLinks.length)
      )
        throw refused();
      const shared = await shareSnapshot(tx, "flight", old.source.id);
      await tx.flight.deleteMany({ where: { id: old.source.id, userId, tripId } });
      await propagateDelete(tx, userId, shared);
      item.source = null;
      const booking = next.bookings.find((x) => x.id === old.bookingId);
      if (booking && !booking.actualBookingId)
        booking.actualBookingId =
          before.bookings.find((x) => x.id === old.bookingId)?.actualBookingId ?? null;
      await withdrawBooking(tx, userId, tripId, booking, old.source.bookingVersion, next);
    } else if (old?.source?.kind === "planHotel") {
      const stay = await tx.lodgingStay.findFirst({
        where: { id: old.source.id, userId },
        include: { documents: true },
      });
      if (
        stay &&
        (stay.tripId !== tripId ||
          stay.updatedAt.toISOString() !== old.source.version ||
          stay.documents.length)
      )
        throw refused();
      const shared = await shareSnapshot(tx, "lodgingStay", old.source.id);
      await tx.lodgingStay.deleteMany({ where: { id: old.source.id, userId, tripId } });
      await propagateDelete(tx, userId, shared);
      item.source = null;
      if (
        old.source.createdAux &&
        old.source.auxId &&
        (await tx.lodgingStay.count({ where: { lodgingId: old.source.auxId } })) === 0
      ) {
        const lodging = await tx.lodging.findFirst({
          where: { id: old.source.auxId, userId },
          include: { photos: true },
        });
        if (
          lodging &&
          (lodging.updatedAt.toISOString() !== old.source.auxVersion || lodging.photos.length)
        )
          throw refused();
        // share-exempt: deletes the house the plan itself created for the stay it just replaced
        await tx.lodging.deleteMany({ where: { id: old.source.auxId, userId } });
      }
      const booking = next.bookings.find((x) => x.id === old.bookingId);
      if (booking && !booking.actualBookingId)
        booking.actualBookingId =
          before.bookings.find((x) => x.id === old.bookingId)?.actualBookingId ?? null;
      await withdrawBooking(tx, userId, tripId, booking, old.source.bookingVersion, next);
    }
  }
}
