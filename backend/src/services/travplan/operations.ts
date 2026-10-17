import { randomUUID } from "node:crypto";
import { AppError } from "../../middleware/errorHandler";
import { collectionSchemas } from "./schema";
import { parseState } from "./upgrade";
import { bookingDuration } from "./temporal";
import { transferFingerprint } from "./rules";
import type { PlanState, PlanOperation, PlanItem, PlanBooking } from "./types";
function refuse(message: string): never {
  throw new AppError(message, 409, "PLAN_PROTECTED");
}
export function applyOperation(
  input: PlanState,
  operation: PlanOperation,
  revision: number
): PlanState {
  let state: PlanState = structuredClone(input);
  if (operation.type === "settings") {
    Object.assign(state, operation.values);
    if (
      state.latitude !== input.latitude ||
      state.longitude !== input.longitude ||
      state.timezone !== input.timezone
    )
      state.forecast = null;
  } else if (operation.type === "assign_idea") {
    const idea = state.ideas.find((i) => i.id === operation.ideaId);
    if (!idea) throw new AppError("Idea not found", 404, "PLAN_ITEM_NOT_FOUND");
    let item = state.items.find((i) => i.id === idea.itemId);
    if (item && (item.booked || item.source)) refuse("This idea is a fixed anchor");
    if (!item) {
      item = {
        id: randomUUID(),
        title: idea.title,
        kind: "activity",
        day: null,
        time: null,
        duration: null,
        timezone: state.timezone,
        place: "",
        note: idea.note,
        booked: false,
        bookingId: null,
        stationId: null,
        execution: "unconfirmed",
        source: null,
      };
      state.items.push(item);
      idea.itemId = item.id;
    }
    Object.assign(item, { day: operation.day, time: operation.time, duration: operation.duration });
  } else if (operation.type === "handover") {
    state.status = "ready";
    state.handoverRevision = revision + 1;
  } else if (operation.type === "execution") {
    const item = state.items.find((i) => i.id === operation.id);
    if (!item) throw new AppError("Plan item not found", 404, "PLAN_ITEM_NOT_FOUND");
    item.execution = operation.execution;
    if (item.source?.kind.startsWith("linkedActual:") && operation.execution !== "confirmed")
      item.source = null;
  } else if (operation.type === "decision") {
    state.decisions = state.decisions
      .filter((d) => d.id !== operation.value.id)
      .concat({ ...operation.value, decidedAt: new Date().toISOString() });
  } else if (operation.type === "upsert") {
    const key = operation.collection,
      value = collectionSchemas[key].parse(operation.value),
      existing = state[key].find((x) => x.id === value.id);
    if (key === "items") {
      const item = value as PlanItem,
        previous = existing as PlanItem | undefined;
      if (previous?.booked || previous?.source)
        refuse("Edit the booking instead of a fixed plan anchor");
      if (item.booked || item.bookingId || item.source)
        refuse("Fixed anchors are created from reviewed bookings");
      if (item.execution !== (previous?.execution || "unconfirmed"))
        refuse("Confirm execution explicitly");
    }
    if (key === "bookings") {
      const previousBooking = existing as PlanBooking | undefined;
      if (previousBooking?.source === "existing")
        refuse("Review existing booking data in TravStats");
      if (
        (!previousBooking?.actualBookingId && (value as PlanBooking).actualBookingId) ||
        (previousBooking?.actualBookingId &&
          (value as PlanBooking).actualBookingId !== previousBooking.actualBookingId)
      )
        refuse("Actual booking links cannot be edited here");

      const booking = value as PlanBooking,
        duplicate = booking.reference
          ? state.bookings.find(
              (b) =>
                b.kind === booking.kind &&
                b.reference?.toLowerCase() === booking.reference?.toLowerCase() &&
                b.id !== booking.id &&
                b.day === booking.day &&
                b.endDay === booking.endDay &&
                b.originPlace === booking.originPlace &&
                b.place === booking.place &&
                b.details.flightNumber === booking.details.flightNumber
            )
          : undefined;
      if (duplicate) {
        if (
          duplicate.actualBookingId ||
          state.items.some((i) => i.bookingId === duplicate.id && i.source)
        )
          refuse("Review the existing actual booking instead of reimporting it");
        booking.id = duplicate.id;
        booking.priceGroupId = duplicate.priceGroupId;
      }
      if (existing && state.items.some((i) => i.bookingId === booking.id && i.source))
        refuse("Review actual bookings in TravStats");
      let item = state.items.find((i) => i.bookingId === booking.id);
      if (!item) {
        item = {
          id: randomUUID(),
          title: booking.title,
          kind: booking.kind,
          day: booking.day,
          time: booking.time,
          duration: null,
          timezone: booking.timezone,
          place: booking.place,
          note: "",
          booked: true,
          bookingId: booking.id,
          stationId: null,
          execution: "unconfirmed",
          source: null,
        };
        state.items.push(item);
      }
      Object.assign(item, {
        title: booking.title,
        kind: booking.kind,
        duration: bookingDuration(booking),
        day: booking.day,
        time: booking.time,
        timezone: booking.timezone,
        place: booking.place,
      });
      if (booking.priceGroupId)
        for (const related of state.bookings.filter(
          (b) => b.priceGroupId === booking.priceGroupId && b.id !== booking.id
        )) {
          if (related.actualBookingId) refuse("Review actual booking costs in TravStats");
          Object.assign(related, {
            amount: booking.amount,
            paid: booking.paid,
            currency: booking.currency,
          });
        }
      const booked = state.bookings.find((b) => b.id === booking.id);
      if (booked && booked.kind !== booking.kind) refuse("A booking cannot change its kind");
    }
    if (key === "transfers") {
      const transfer = value as PlanState["transfers"][number];
      if (
        !state.items.some((i) => i.id === transfer.fromId) ||
        !state.items.some((i) => i.id === transfer.toId)
      )
        refuse("Transfer endpoints must belong to this plan");
      transfer.fingerprint =
        transfer.status === "organized"
          ? transferFingerprint(state, transfer.fromId, transfer.toId)
          : transfer.fingerprint;
    }
    state = { ...state, [key]: state[key].filter((x) => x.id !== value.id).concat(value as never) };
  } else if (operation.type === "remove") {
    const row = state[operation.collection].find((i) => i.id === operation.id);
    if (!row) throw new AppError("Plan entry not found", 404, "PLAN_ITEM_NOT_FOUND");
    if (operation.collection === "items" && ((row as PlanItem).booked || (row as PlanItem).source))
      refuse("Fixed anchors cannot be removed here");
    if (operation.collection === "bookings")
      refuse("Keep the booking record; cancel the planned execution instead");
    state = {
      ...state,
      [operation.collection]: state[operation.collection].filter((i) => i.id !== operation.id),
    };
    if (operation.collection === "items") {
      state.ideas = state.ideas.map((i) =>
        i.itemId === operation.id ? { ...i, itemId: null } : i
      );
      state.transfers = state.transfers.filter(
        (t) => t.fromId !== operation.id && t.toId !== operation.id
      );
    }
  } else refuse("Operation must be resolved by the transaction");
  state = parseState(state);
  for (const key of Object.keys(collectionSchemas) as (keyof typeof collectionSchemas)[])
    if (new Set(state[key].map((i) => i.id)).size !== state[key].length)
      refuse("Duplicate plan identifiers");
  if (state.items.some((i) => i.bookingId && !state.bookings.some((b) => b.id === i.bookingId)))
    refuse("Booking link is missing");
  if (state.ideas.some((i) => i.itemId && !state.items.some((x) => x.id === i.itemId)))
    refuse("Idea points to a missing plan item");
  if (Buffer.byteLength(JSON.stringify(state)) > 1024 * 1024)
    throw new AppError("Plan is too large", 413, "PLAN_TOO_LARGE");
  return state;
}
export function applyProposal(
  state: PlanState,
  changes: { id: string; day: string | null; time: string | null }[]
): PlanState {
  const next = structuredClone(state),
    seen = new Set<string>();
  for (const c of changes) {
    const item = next.items.find((i) => i.id === c.id);
    if (!item || item.booked || item.source || item.execution !== "unconfirmed" || seen.has(c.id))
      refuse("Proposal touches a missing or protected entry");
    seen.add(c.id);
    if (
      c.day &&
      ((state.startDay && c.day < state.startDay) ||
        (state.endDay && c.day > state.endDay) ||
        state.freeDays.includes(c.day))
    )
      refuse("Proposal moves an entry outside the allowed days");
    item.day = c.day;
    item.time = c.time;
  }
  return parseState(next);
}
