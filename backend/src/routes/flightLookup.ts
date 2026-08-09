/**
 * Flight Lookup API Routes
 *
 * Endpoints for looking up flight data by flight number
 */

import { Router, Response, NextFunction } from 'express';
import {
  lookupFlightByNumber,
  lookupFlightWithHistorical,
  parseFlightNumber,
} from '../services/flightLookup';
import { flightLookupLimiter } from '../middleware/rateLimit';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * GET /api/v1/flight-lookup/:flightNumber?date=2024-01-15
 * Lookup flight by number and optional date
 */
router.get('/:flightNumber', authenticate, flightLookupLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { flightNumber } = req.params;
    const { date } = req.query;

    if (!flightNumber) {
      return res.status(400).json({
        success: false,
        error: 'Flight number is required',
      });
    }

    // Parse optional date
    let searchDate: Date | undefined;
    if (date && typeof date === 'string') {
      searchDate = new Date(date);
      if (isNaN(searchDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD',
        });
      }
    }

    // Lookup via the full provider cascade so dates within the OpenSky
    // 30-day window also resolve. The previous AirLabs-only path silently
    // ignored `dep_date` and returned today's schedule (issue #82). The
    // wrapper also runs a date-mismatch safety net for both past and future
    // requests so providers returning "today" for non-today queries don't
    // mislead the user.
    const { flights, unavailableReason } = await lookupFlightWithHistorical(
      flightNumber,
      searchDate,
      req.userId,
    );

    // Distinct from 'no_provider' below: there is no provider AT ALL, so the
    // action is "add a key", not "this date needs a paid tier". Reporting
    // this as "no flights found" sent fresh installs hunting for a better
    // date for a search that never ran (#232).
    if (unavailableReason === 'not_configured') {
      return res.status(200).json({
        success: false,
        count: 0,
        error: 'LOOKUP_NOT_CONFIGURED',
        message:
          'No flight-data provider is configured, so no search was performed. Add an API key under Settings, or enter the flight manually.',
      });
    }

    if (unavailableReason === 'no_provider') {
      return res.status(200).json({
        success: false,
        count: 0,
        error: 'LOOKUP_UNAVAILABLE',
        message:
          'This flight search is not available on the free providers. The free tier only covers live flights (today). For past or future flights, configure an Aviationstack Basic+ key in Settings, or enter the flight manually.',
      });
    }

    if (flights.length === 0) {
      // Provide helpful response but do not fail the request (status 200 to avoid proxy errors).
      const parsed = parseFlightNumber(flightNumber);
      let errorCode = 'No flights found';
      let hint = 'Try adding a date parameter or check if the flight number is correct';
      if (unavailableReason === 'no_match') {
        errorCode = 'NO_FLIGHT_DATA_FOR_DATE';
        hint =
          'Provider returned no usable data for this flight on this date. Please double-check the flight number and date, or enter the flight manually.';
      } else if (unavailableReason === 'no_match_api_gap') {
        errorCode = 'NO_FLIGHT_DATA_API_GAP';
        hint =
          'No data available from the configured providers for this flight on this date. The flight may simply not be in the API for that date — please enter it manually.';
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
});

/**
 * POST /api/v1/flight-lookup/bulk
 * Lookup multiple flights at once
 */
router.post('/bulk', authenticate, flightLookupLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { flightNumbers, date } = req.body;

    if (!Array.isArray(flightNumbers) || flightNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'flightNumbers array is required',
      });
    }

    if (flightNumbers.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 10 flight numbers allowed per request',
      });
    }

    // Parse optional date
    let searchDate: Date | undefined;
    if (date) {
      searchDate = new Date(date);
      if (isNaN(searchDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid date format. Use YYYY-MM-DD',
        });
      }
    }

    // Lookup all flights
    const results = await Promise.all(
      flightNumbers.map(async (flightNumber) => {
        try {
          const flights = await lookupFlightByNumber(flightNumber, searchDate);
          return {
            flightNumber,
            success: true,
            flights,
          };
        } catch (error: unknown) {
          return {
            flightNumber,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
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
});

export default router;
