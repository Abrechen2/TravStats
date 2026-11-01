/**
 * Flight Lookup API Routes
 *
 * Endpoints for looking up flight data by flight number
 */

import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import {
  lookupFlightByNumber,
  lookupFlightWithHistorical,
  parseFlightNumber,
} from "../services/flightLookup";
import { flightLookupLimiter } from "../middleware/rateLimit";
import { authenticate, AuthRequest } from "../middleware/auth";
import { rejectDemoQuota } from "../middleware/demoGuard";
import { LookupOutcomeLog } from "../services/flightLookup/providerOutcome";

const BULK_MAX = 10;
const bulkLookupSchema = z
  .object({
    /** One date for every number (the original shape). */
    flightNumbers: z.array(z.string().trim().min(1).max(20)).min(1).max(BULK_MAX).optional(),
    date: z.string().max(40).optional(),
    /**
     * Additive (forgejo#407): one date per flight, which an import file or a
     * logbook selection needs — its rows fall on different days.
     */
    items: z
      .array(
        z.object({
          flightNumber: z.string().trim().min(1).max(20),
          date: z.string().max(40).optional(),
        })
      )
      .min(1)
      .max(BULK_MAX)
      .optional(),
  })
  .refine((v) => (v.flightNumbers === undefined) !== (v.items === undefined), {
    message: "Send either flightNumbers or items",
  });

const router = Router();

/**
 * GET /api/v1/flight-lookup/:flightNumber?date=2024-01-15
 * Lookup flight by number and optional date
 */
router.get(
  "/:flightNumber",
  authenticate,
  // Every lookup here is a billed RapidAPI call on the operator's key
  // (`apiKeyResolver` has no per-user branch for this provider), so the same
  // guard the bulk historical refresh carries applies: `rejectDemoQuota`, keyed
  // on `isDemo` alone rather than on the shared account, because a seeded
  // account's sample flights cost real quota whichever of them asks. The bulk
  // refresh was guarded and this was not, which was an inconsistency rather
  // than a policy (security audit of 2026-09-19, finding 2).
  rejectDemoQuota,
  flightLookupLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { flightNumber } = req.params;
      const { date, tz } = req.query;

      if (!flightNumber) {
        return res.status(400).json({
          success: false,
          error: "Flight number is required",
        });
      }

      // Parse optional date
      let searchDate: Date | undefined;
      if (date && typeof date === "string") {
        searchDate = new Date(date);
        if (isNaN(searchDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid date format. Use YYYY-MM-DD",
          });
        }
      }

      // Lookup via the full provider cascade so dates within the OpenSky
      // 30-day window also resolve. The previous AirLabs-only path silently
      // ignored `dep_date` and returned today's schedule (issue #82). The
      // wrapper also runs a date-mismatch safety net for both past and future
      // requests so providers returning "today" for non-today queries don't
      // mislead the user.
      // `tz` is the asker's zone: it decides what "today" is while the
      // departure airport is still unknown. An unusable value is ignored.
      const { flights, unavailableReason, providerFailures } = await lookupFlightWithHistorical(
        flightNumber,
        searchDate,
        req.userId,
        undefined,
        { clientTimezone: typeof tz === "string" ? tz : undefined }
      );

      // A provider that failed (refused key, spent quota, timeout) did not say
      // "no such flight". Reported as "No flights found" it sent the user to
      // re-check a number that was right while the key was the problem.
      if (unavailableReason === "provider_failed") {
        return res.status(200).json({
          success: false,
          count: 0,
          error: "LOOKUP_PROVIDER_FAILED",
          providerFailures: providerFailures ?? [],
          message:
            "A flight-data provider could not answer (see providerFailures), so the absence of a result is not a finding.",
        });
      }

      // Distinct from 'no_provider' below: there is no provider AT ALL, so the
      // action is "add a key", not "this date needs a paid tier". Reporting
      // this as "no flights found" sent fresh installs hunting for a better
      // date for a search that never ran (#232).
      if (unavailableReason === "not_configured") {
        return res.status(200).json({
          success: false,
          count: 0,
          error: "LOOKUP_NOT_CONFIGURED",
          message:
            "No flight-data provider is configured, so no search was performed. Add an API key under Settings, or enter the flight manually.",
        });
      }

      if (unavailableReason === "no_provider") {
        return res.status(200).json({
          success: false,
          count: 0,
          error: "LOOKUP_UNAVAILABLE",
          message:
            "This flight search is not available on the free providers. The free tier only covers live flights (today). For past or future flights, configure an Aviationstack Basic+ key in Settings, or enter the flight manually.",
        });
      }

      if (flights.length === 0) {
        // Provide helpful response but do not fail the request (status 200 to avoid proxy errors).
        const parsed = parseFlightNumber(flightNumber);
        let errorCode = "No flights found";
        let hint = "Try adding a date parameter or check if the flight number is correct";
        if (unavailableReason === "no_match") {
          errorCode = "NO_FLIGHT_DATA_FOR_DATE";
          hint =
            "Provider returned no usable data for this flight on this date. Please double-check the flight number and date, or enter the flight manually.";
        } else if (unavailableReason === "no_match_api_gap") {
          errorCode = "NO_FLIGHT_DATA_API_GAP";
          hint =
            "No data available from the configured providers for this flight on this date. The flight may simply not be in the API for that date — please enter it manually.";
        }
        return res.status(200).json({
          success: false,
          count: 0,
          error: errorCode,
          parsed,
          hint,
        });
      }

      res.json({
        success: true,
        count: flights.length,
        flights,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/flight-lookup/bulk
 * Lookup multiple flights at once
 */
router.post(
  "/bulk",
  authenticate,
  // Ten lookups per call — see the comment on the single lookup above.
  rejectDemoQuota,
  flightLookupLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const parsed = bulkLookupSchema.safeParse(req.body);
      if (!parsed.success) {
        const tooMany = parsed.error.issues.some((i) => i.code === "too_big");
        return res.status(400).json({
          success: false,
          error: tooMany
            ? "Maximum 10 flight numbers allowed per request"
            : "flightNumbers array is required",
        });
      }
      const { flightNumbers, date, items } = parsed.data;
      const rows: Array<{ flightNumber: string; date?: string }> =
        items ?? (flightNumbers ?? []).map((flightNumber) => ({ flightNumber, date }));

      // An unreadable date is the row's own failure when the rows carry their
      // own dates; with one shared date it stays a 400 for the whole request.
      const parseDate = (raw?: string): Date | undefined | "invalid" => {
        if (!raw) return undefined;
        const d = new Date(raw);
        return isNaN(d.getTime()) ? "invalid" : d;
      };
      if (!items && parseDate(date) === "invalid") {
        return res.status(400).json({
          success: false,
          error: "Invalid date format. Use YYYY-MM-DD",
        });
      }

      // Lookup all flights. The asker's id selects THEIR provider keys, and an
      // outcome log tells "no such flight" from "a provider could not answer".
      const results = await Promise.all(
        rows.map(async ({ flightNumber, date: rowDate }, index) => {
          const searchDate = parseDate(rowDate);
          if (searchDate === "invalid") {
            return {
              index,
              flightNumber,
              date: rowDate,
              success: false,
              error: "INVALID_DATE",
              providerFailures: [],
            };
          }
          const outcomes = new LookupOutcomeLog();
          try {
            const flights = await lookupFlightByNumber(
              flightNumber,
              searchDate,
              req.userId,
              outcomes
            );
            const providerFailures = outcomes.failures();
            if (flights.length === 0 && providerFailures.length > 0) {
              return {
                index,
                flightNumber,
                date: rowDate,
                success: false,
                error: "LOOKUP_PROVIDER_FAILED",
                providerFailures,
              };
            }
            return {
              index,
              flightNumber,
              date: rowDate,
              success: true,
              flights,
              providerFailures,
            };
          } catch (error: unknown) {
            return {
              index,
              flightNumber,
              date: rowDate,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
              providerFailures: outcomes.failures(),
            };
          }
        })
      );

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
