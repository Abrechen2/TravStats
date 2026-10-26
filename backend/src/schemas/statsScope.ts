import { z } from "./zod";

/** companion-redesign C4: what a year-scopable answer says it covers. */
export const statsScopeSchema = z
  .object({
    year: z
      .number()
      .int()
      .nullable()
      .describe("The local calendar year the answer covers; null = all-time"),
  })
  .describe(
    "Check this rather than the status code: a server without `year` on an endpoint " +
      "ignores the parameter and answers all-time with no `scope`."
  );
