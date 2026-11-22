import { z } from "zod";

/** `GET /gap-calendar` (spec 2026-11-22-gap-calendar). */
export const gapCalendarQuerySchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/, "year is YYYY")
    .transform(Number)
    .refine((y) => y >= 1970 && y <= 2100, "year is between 1970 and 2100")
    .describe("The calendar year in the account's profile zone, `YYYY`"),
});
