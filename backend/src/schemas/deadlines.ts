import { dayFieldSchema, timeFieldSchema } from "../shared/time/timeInput";

/**
 * The inbound booking-deadline fields (forgejo#285) — shared by stays,
 * rentals, bookings and (the check-in opening) flights. The resolution lives
 * in `services/deadlines/bookingDeadlines.ts`; this file only holds shapes, so
 * a schema module never pulls the database in.
 */

const CANCELLATION_DESCRIPTION =
  "Free cancellation is possible until this point (forgejo#285), as the confirmation states " +
  "it. `{local, …}` / an offset-bearing instant: the instant, on the clock it was stated on. " +
  "`YYYY-MM-DD`: known only to the day — free cancellation until the end of that local day " +
  "(`times.freeCancellationOn`); no hour is invented. Null clears; absent leaves it alone.";

const PAYMENT_DESCRIPTION =
  "The day payment is due, `YYYY-MM-DD` — a calendar day with no zone (forgejo#285). " +
  "Null clears; absent leaves it alone.";

const CHECK_IN_DESCRIPTION =
  "When online check-in opens (forgejo#285), as the airline states it — normally on the " +
  "departure airport's clock, which is the zone used when `{local}` names none. Null clears; " +
  "absent leaves it alone.";

/**
 * The inbound fields for an entity with a cancellation and a payment
 * deadline. `impliedPlace`: the entity names a place (a stay's hotel, a
 * rental's pickup station) whose zone a bare `{local}` may lean on.
 */
export function deadlineInputShape(options: { impliedPlace: boolean }) {
  return {
    freeCancellationUntil: timeFieldSchema({ impliedPlace: options.impliedPlace, allowDate: true })
      .nullable()
      .optional()
      .openapi({ description: CANCELLATION_DESCRIPTION }),
    paymentDueOn: dayFieldSchema()
      .nullable()
      .optional()
      .openapi({ description: PAYMENT_DESCRIPTION }),
  };
}

/** The flight's inbound field; a bare `{local}` is read on the departure airport's clock. */
export const onlineCheckInInputShape = {
  onlineCheckInOpensAt: timeFieldSchema({ impliedPlace: true })
    .nullable()
    .optional()
    .openapi({ description: CHECK_IN_DESCRIPTION }),
};
