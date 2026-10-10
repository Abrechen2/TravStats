import { z } from "zod";

/**
 * The raw DAY deadline columns (forgejo#285) as a stay, a rental and a booking
 * answer them: `YYYY-MM-DD`, never the JS midnight `prismaColumns` would
 * describe. Spread after `prismaColumns(...)`. The instant column
 * (`freeCancellationUntil`) stays a real UTC instant with its zone beside it.
 */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const deadlineDayColumns = {
  freeCancellationOn: day.describe(
    "Free cancellation until the end of this day, when the deadline is known only to the day " +
      "(`times.freeCancellationOn`); null when not recorded or when `freeCancellationUntil` holds it"
  ),
  paymentDueOn: day.describe("The day payment is due (`times.paymentDue`); null = not recorded"),
};
