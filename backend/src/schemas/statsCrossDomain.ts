import { z } from "./zod";

/**
 * `GET /stats/cross-domain` (forgejo#399). The rules behind every block are in
 * `utils/stats/crossDomain/*`; the headline of each is repeated in its
 * description because a client reads this spec, not the source. A block that
 * cannot be derived is `null`, never a zero.
 */
const day = z
  .string()
  .openapi({ example: "2026-03-14", description: "A calendar day, YYYY-MM-DD." });
const month = z.string().openapi({ example: "2026-03", description: "YYYY-MM." });

const dayRun = z.object({ days: z.number().int(), from: day, to: day });
const monthRun = z.object({ months: z.number().int(), from: month, to: month });

const rhythm = z.object({
  days: z.number().int(),
  bySeason: z.object({
    winter: z.number().int(),
    spring: z.number().int(),
    summer: z.number().int(),
    autumn: z.number().int(),
  }),
  byWeekday: z.array(z.number().int()).length(7).openapi({ description: "Monday first." }),
});

const top = z.object({ key: z.string(), label: z.string(), count: z.number().int() });
const unseenEntry = z.object({
  key: z.string(),
  label: z.string(),
  lastVisit: day,
  yearsAgo: z.number().int(),
});

export const crossDomainStatsSchema = z
  .object({
    asOf: day.openapi({
      description: "Today in the user's profile zone — the day every figure is read at.",
    }),
    streaks: z
      .object({
        activeDays: z.number().int(),
        longestDayStreak: dayRun.nullable(),
        currentDayStreak: dayRun.nullable().openapi({
          description:
            "A run that reaches today or yesterday; null when nothing is running — not a streak of 0.",
        }),
        longestMonthStreak: monthRun.nullable(),
        currentMonthStreak: monthRun.nullable(),
      })
      .nullable()
      .openapi({
        description:
          "Runs of consecutive days (and months) with at least one record in ANY domain — the " +
          "union of days, never a sum. Null without a single active day.",
      }),
    rhythm: z
      .object({ overall: rhythm, byDomain: z.record(z.string(), rhythm) })
      .nullable()
      .openapi({
        description:
          "Distinct active days per season (meteorological, northern hemisphere) and weekday. " +
          "`overall` is the union of the domains; the per-domain figures are NOT to be added up.",
      }),
    timeShift: z
      .object({
        flightsMeasured: z.number().int(),
        unmeasured: z.number().int(),
        hoursShifted: z.number(),
        biggestJump: z
          .object({
            flightId: z.string(),
            hours: z.number().openapi({ description: "Signed; positive is eastward." }),
            from: z.string().nullable(),
            to: z.string().nullable(),
            date: day,
          })
          .nullable(),
        jetLagDays: z.number(),
        jetLagRule: z.object({
          minHours: z.number(),
          eastPerHour: z.number(),
          westPerHour: z.number(),
        }),
      })
      .nullable()
      .openapi({
        description:
          "Sum of absolute UTC-offset changes between each flight's departure and arrival zone at " +
          "the instants flown. Flights with a date-only time or an unknown zone are left out " +
          "(`unmeasured`). `jetLagDays` is an estimate under `jetLagRule`.",
      }),
    unseen: z
      .object({
        country: z.array(unseenEntry).nullable(),
        airport: z.array(unseenEntry).nullable(),
        place: z.array(unseenEntry).nullable(),
      })
      .nullable()
      .openapi({
        description:
          "The entries not visited for at least one whole year, longest absence first, at most " +
          "ten per kind. A kind with no dated sighting at all is null.",
      }),
    pricePerKm: z
      .object({
        blocks: z.array(
          z.object({
            domain: z.enum(["rail", "bus", "ferry"]),
            currency: z.string(),
            rides: z.number().int(),
            spend: z.number(),
            spendWithKm: z.number().openapi({
              description:
                "The part of `spend` on rides that have a distance; `pricePerKm` = this / `km`.",
            }),
            km: z.number().nullable(),
            pricePerKm: z.number().nullable(),
            ridesWithoutKm: z.number().int(),
          })
        ),
        bookedRides: z.number().int(),
      })
      .nullable()
      .openapi({
        description:
          "Per domain and ORIGINAL currency — never added across currencies. Rides whose price " +
          "sits on a shared booking are left out (`bookedRides`).",
      }),
    nightsByCountry: z
      .object({
        totalNights: z.number().int(),
        countries: z.array(
          z.object({
            country: z.string(),
            hotel: z.number().int(),
            rail: z.number().int(),
            bus: z.number().int(),
            total: z.number().int(),
          })
        ),
        unattributed: z.object({
          hotel: z.number().int(),
          sea: z.number().int(),
          rail: z.number().int(),
          bus: z.number().int(),
          air: z.number().int(),
        }),
      })
      .nullable()
      .openapi({
        description:
          "The travel account's nights (one award per night) attributed to the country they were " +
          "spent in. Cabin, border-crossing sleeper and air nights are `unattributed`.",
      }),
    schengen: z
      .object({
        asOf: day,
        windowDays: z.number().int(),
        allowedDays: z.number().int(),
        daysUsed: z.number().int(),
        daysRemaining: z.number().int(),
        windowFrom: day,
        lastDayUsed: day.nullable(),
      })
      .nullable()
      .openapi({
        description:
          "Distinct days with a record in a Schengen country within the 180 days ending today. A " +
          "logbook count, not legal advice: a day without a record is not a day outside. Null " +
          "without any dated presence record.",
      }),
    photos: z
      .object({
        photos: z.number().int(),
        withoutDate: z.number().int(),
        withoutCountry: z.number().int(),
        busiestDay: z.object({ day, count: z.number().int() }).nullable(),
        topTrips: z.array(top),
        topCountries: z.array(top),
        topPlaces: z.array(top),
      })
      .nullable()
      .openapi({
        description:
          "From the stored taken-at time and EXIF coordinates of trip photos. Camera fields are " +
          "not stored and not reported.",
      }),
    unavailable: z
      .array(
        z.enum([
          "streaks",
          "rhythm",
          "timeShift",
          "unseen",
          "pricePerKm",
          "nightsByCountry",
          "schengen",
          "photos",
        ])
      )
      .openapi({
        description:
          "Blocks whose load failed (null here, but not 'no data'). The client says so rather than hiding the card.",
      }),
  })
  .openapi("CrossDomainStats");

export type CrossDomainStats = z.infer<typeof crossDomainStatsSchema>;
