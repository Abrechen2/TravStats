/**
 * Flight Lookup API Routes
 *
 * Endpoints for looking up flight data by flight number
 */

import { Router, Request, Response, NextFunction } from 'express';
import { lookupFlightByNumber, parseFlightNumber } from '../services/flightLookup';

const router = Router();

/**
 * GET /api/v1/flight-lookup/:flightNumber?date=2024-01-15
 * Lookup flight by number and optional date
 */
router.get('/:flightNumber', async (req: Request, res: Response, next: NextFunction) => {
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

    // Lookup flight
    const flights = await lookupFlightByNumber(flightNumber, searchDate);

    if (flights.length === 0) {
      // Provide helpful response but do not fail the request (status 200 to avoid proxy errors)
      const parsed = parseFlightNumber(flightNumber);
      return res.status(200).json({
        success: false,
        count: 0,
        error: 'No flights found',
        parsed,
        hint: 'Try adding a date parameter or check if the flight number is correct',
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
router.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
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
        } catch (error: any) {
          return {
            flightNumber,
            success: false,
            error: error.message,
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
