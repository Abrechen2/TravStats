import { z } from "./zod";
import { CLIENT_FX_SOURCES, EXPENSE_FX_SOURCES, EXPENSE_KINDS } from "../shared/expenses";
import { currencyField } from "./lodging";

/**
 * Trip and roadtrip expenses (forgejo#140). Input AND response shapes, so the
 * OpenAPI description and the code infer from one definition.
 */

/** A calendar day as "YYYY-MM-DD" that exists (no 2026-02-30) — the place's local day. */
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a calendar day");

const MAX_AMOUNT = 1_000_000_000;

const expenseFields = {
  kind: z.enum(EXPENSE_KINDS),
  amount: z
    .number()
    .min(0)
    .max(MAX_AMOUNT)
    .openapi({ description: "In `currency`; stored to four decimals." }),
  currency: currencyField.openapi({ description: "ISO 4217, upper-case.", example: "NOK" }),
  date: calendarDay
    .nullable()
    .optional()
    .openapi({
      description:
        "The local calendar day it was paid, as `YYYY-MM-DD`. Null or absent: undated — " +
        "counted in every total and in no year.",
    }),
  note: z.string().trim().max(2000).nullable().optional(),
  stopId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .openapi({
      description:
        "Pins it to a station: a pitch fee, a fuel stop. Must be a stop of the same " +
        "trip or section; a route correction (via point) is refused.",
    }),
  legFromStopId: z.string().uuid().nullable().optional(),
  legToStopId: z.string().uuid().nullable().optional(),
  payer: z
    .union([
      z.object({ companionId: z.string().uuid() }).strict(),
      z.object({ name: z.string().trim().min(1).max(100) }).strict(),
    ])
    .nullable()
    .optional()
    .openapi({
      description:
        "Who paid (forgejo#150) — recorded, never split. One of the caller's companions " +
        "(`{ companionId }`, from `GET /companions`), or a plain name (`{ name }`) for a " +
        "one-off payer or a capture made offline. Null clears it; absent leaves it alone.",
    }),
  fx: z
    .object({
      rate: z
        .number()
        .positive()
        .max(MAX_AMOUNT)
        .openapi({ description: "Units of `baseCurrency` per one unit of `currency`." }),
      rateDate: calendarDay.openapi({ description: "The day the rate is for, `YYYY-MM-DD`." }),
      baseCurrency: currencyField.openapi({ description: "ISO 4217, upper-case." }),
      source: z.enum(CLIENT_FX_SOURCES).openapi({
        description: "`cached`: the client's offline rate table; `manual`: typed by the user.",
      }),
    })
    .strict()
    .nullable()
    .optional()
    .openapi({
      description:
        "A rate the client already has (forgejo#150), stored as given; `amountBase` is " +
        "`amount × rate`, rounded to the base currency's minor unit. Absent: the server " +
        "looks a rate up itself for a dated expense (create), or when amount, currency or " +
        "day changed (update). Null removes the stored rate.",
    }),
};

/** Both ends of the way between two stations, or neither. */
function legPairComplete(body: { legFromStopId?: string | null; legToStopId?: string | null }) {
  const from = body.legFromStopId ?? null;
  const to = body.legToStopId ?? null;
  return (from === null) === (to === null) && (from === null || from !== to);
}

/** Exported for the PATCH, which can only check it against the stored row. */
export const STATION_OR_LEG_MESSAGE =
  "An expense sits on a station or on the way between two, not both";

const LEG_PAIR_MESSAGE =
  "legFromStopId and legToStopId come together, and name two different stops";

export const createExpenseSchema = z
  .object({
    ...expenseFields,
    routeId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .openapi({
        description:
          "On `/trips/{id}/expenses` only: put it on a section (roadtrip or tour) of this " +
          "trip instead of on the trip, so it moves with the section. Its stops must then be " +
          "that section's. Refused on the route-scoped paths, which already name one.",
      }),
    documentIds: z
      .array(z.string().uuid())
      .max(20)
      .optional()
      .openapi({
        description:
          "Kept documents (`POST /documents`) to file with the new expense — a receipt " +
          "uploaded before its expense existed. An unknown, foreign or already-filed id " +
          "fails the create.",
      }),
  })
  .strict()
  .refine(legPairComplete, { message: LEG_PAIR_MESSAGE, path: ["legToStopId"] })
  .refine((b) => b.stopId == null || b.legFromStopId == null, {
    message: STATION_OR_LEG_MESSAGE,
    path: ["stopId"],
  });

/**
 * PATCH — every field optional, and an omitted field is left alone. The
 * scope (trip or section) never changes on a PATCH; delete and recreate.
 */
export const updateExpenseSchema = z
  .object({
    kind: expenseFields.kind.optional(),
    amount: expenseFields.amount.optional(),
    currency: expenseFields.currency.optional(),
    date: expenseFields.date,
    note: expenseFields.note,
    stopId: expenseFields.stopId,
    legFromStopId: expenseFields.legFromStopId,
    legToStopId: expenseFields.legToStopId,
    payer: expenseFields.payer,
    fx: expenseFields.fx,
  })
  .strict()
  .refine((b) => "legFromStopId" in b === "legToStopId" in b, {
    message: "Send legFromStopId and legToStopId together",
    path: ["legToStopId"],
  })
  .refine(legPairComplete, { message: LEG_PAIR_MESSAGE, path: ["legToStopId"] });

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

const byCurrency = z.record(z.string(), z.number()).openapi({
  description: "Amount per ISO 4217 code, NEVER summed across currencies. Empty when none.",
  example: { EUR: 142.5, NOK: 890 },
});

export const expenseSchema = z
  .object({
    id: z.string().uuid(),
    tripId: z
      .string()
      .uuid()
      .nullable()
      .openapi({ description: "Set for a trip-wide expense; then `routeId` is null." }),
    routeId: z
      .string()
      .uuid()
      .nullable()
      .openapi({ description: "Set for a section's (roadtrip or tour); then `tripId` is null." }),
    stopId: z.string().uuid().nullable(),
    legFromStopId: z.string().uuid().nullable(),
    legToStopId: z.string().uuid().nullable(),
    kind: z.enum(EXPENSE_KINDS),
    amount: z.number(),
    currency: z.string(),
    date: z.string().nullable().openapi({ description: "`YYYY-MM-DD`, the local day; or null." }),
    note: z.string().nullable(),
    payer: z
      .object({
        companionId: z.string().uuid().nullable().openapi({
          description: "The companion who paid; null for a plain name or a deleted companion.",
        }),
        name: z.string().openapi({
          description:
            "The companion's current name when linked, else the name recorded — which " +
            "survives the companion's deletion.",
        }),
      })
      .nullable()
      .openapi({ description: "Who paid; null when not recorded." }),
    fx: z
      .object({
        amountBase: z.number().openapi({ description: "`amount` in `baseCurrency`." }),
        rate: z
          .number()
          .openapi({ description: "Units of `baseCurrency` per unit of `currency`." }),
        rateDate: z.string().openapi({ description: "`YYYY-MM-DD`, the day the rate is for." }),
        baseCurrency: z.string(),
        source: z.enum(EXPENSE_FX_SOURCES).openapi({
          description:
            "`ecb` / `cdn`: looked up by the server; `cached`: a client's offline rate; " +
            "`manual`: typed. Never present a `cached` or `manual` rate as an official one.",
        }),
      })
      .nullable()
      .openapi({
        description:
          "The recorded exchange rate, or null — undated, or no rate could be had. Such " +
          "an expense is totalled in its own currency only.",
      }),
    documentCount: z.number().int().openapi({
      description: "Documents (receipts) filed with it: `GET /expenses/{id}/documents`.",
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("TripExpense");

export const baseTotalSchema = z
  .object({
    currency: z.string().openapi({ description: "The caller's current base currency." }),
    amount: z.number().openapi({
      description:
        "Every expense paid in `currency`, plus every one whose recorded rate converts " +
        "into `currency`. Covers only those: see `unconverted`.",
    }),
    unconverted: byCurrency.openapi({
      description:
        "What could not honestly be added, per its own currency: no rate recorded, or one " +
        "recorded into a base the caller has since left. Empty means `amount` is complete.",
    }),
  })
  .openapi("ExpenseBaseTotal");

export const expenseListSchema = z.object({
  expenses: z.array(expenseSchema).openapi({
    description: "Dated ones by day, undated ones last; ties by creation.",
  }),
  totals: byCurrency,
  baseTotal: baseTotalSchema,
});

/**
 * What became of the exchange rate on a create or an update (forgejo#150) —
 * the `fxSnapshot` convention of flights and cruises, widened by what only an
 * expense has: a client-supplied rate and an explicit removal.
 */
export const EXPENSE_FX_OUTCOMES = [
  "supplied",
  "snapshotted",
  "unchanged",
  "undated",
  "removed",
  "keptStoredRate",
  "lookupFailed",
] as const;
export type ExpenseFxOutcome = (typeof EXPENSE_FX_OUTCOMES)[number];

export const expenseWriteResultSchema = z.object({
  expense: expenseSchema,
  fxSnapshot: z.enum(EXPENSE_FX_OUTCOMES).openapi({
    description:
      "`supplied`: the body's `fx` was stored. `snapshotted`: the server looked a rate up. " +
      "`unchanged`: amount, currency and day did not move, so the stored rate (if any) " +
      "stands. `undated`: no day, so no rate. `removed`: `fx: null` cleared it. " +
      "`keptStoredRate`: the lookup failed and the stored rate re-priced the new amount. " +
      "`lookupFailed`: no rate could be had — the expense has none now; say so.",
  }),
});

/** What `GET /roadtrips/{id}` adds: the money per station, per leg and in total. */
export const roadtripCostsSchema = z
  .object({
    total: byCurrency,
    totalBase: baseTotalSchema,
    byStation: z
      .array(z.object({ stopId: z.string().uuid(), byCurrency }))
      .openapi({ description: "Stations with at least one expense pinned to them." }),
    byLeg: z.array(
      z.object({ fromStopId: z.string().uuid(), toStopId: z.string().uuid(), byCurrency }).openapi({
        description:
          "Keyed by the two STATIONS it runs between, matching `legs`: a toll recorded " +
          "between a station and a route correction is reported on the station-to-station leg.",
      })
    ),
    unpinned: byCurrency.openapi({
      description:
        "Expenses on the roadtrip but on no station or leg — including a leg whose " +
        "station was since deleted. Counted in `total`.",
    }),
  })
  .openapi("RoadtripCosts");

export type ExpenseDto = z.infer<typeof expenseSchema>;
export type RoadtripCosts = z.infer<typeof roadtripCostsSchema>;
export type ExpenseFxDto = NonNullable<ExpenseDto["fx"]>;
