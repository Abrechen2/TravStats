/**
 * Timezone Utilities
 * 
 * Functions for converting flight times between local airport time and UTC
 */

import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import { getCachedAirport } from '../services/airportCache';
import logger from './logger';

/**
 * Get timezone for an airport by IATA or ICAO code
 * @param airportCode IATA or ICAO code
 * @returns IANA timezone string (e.g., "Europe/Berlin") or null if not found
 */
export async function getAirportTimezone(airportCode: string | null | undefined): Promise<string | null> {
  if (!airportCode) {
    return null;
  }

  try {
    const airport = await getCachedAirport(airportCode);
    return airport?.timezone || null;
  } catch (error) {
    logger.warn({
      operation: 'get_airport_timezone_error',
      message: 'Failed to get airport timezone',
      context: { airportCode },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Convert a local time string to UTC based on airport timezone
 * @param timeString Time string (ISO format or any format that Date can parse)
 * @param airportCode IATA or ICAO code of the airport
 * @returns UTC ISO string or null if conversion fails
 */
export async function convertLocalTimeToUtc(
  timeString: string | null | undefined,
  airportCode: string | null | undefined
): Promise<string | null> {
  if (!timeString || !airportCode) {
    return null;
  }

  try {
    const timezone = await getAirportTimezone(airportCode);
    if (!timezone) {
      // If no timezone found, try to parse as UTC
      logger.debug({
        operation: 'convert_local_time_no_timezone',
        message: 'No timezone found for airport, treating as UTC',
        context: { airportCode, timeString },
      });
      const date = new Date(timeString);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }

    // Parse the time string as a local time in the airport's timezone
    // If the time string already has timezone info, Date will use that
    // Otherwise, we need to treat it as local time in the airport's timezone
    let localDate: Date;
    
    // Check if timeString already has timezone information
    if (timeString.includes('Z') || timeString.includes('+') || timeString.match(/[+-]\d{2}:\d{2}$/)) {
      // Already has timezone info, parse directly
      localDate = new Date(timeString);
    } else {
      // No timezone info - treat as local time in airport's timezone
      // Create a date string with timezone info
      const dateStr = timeString.replace('T', ' ').replace(/\.\d{3}/, '');
      // Use zonedTimeToUtc to convert from airport timezone to UTC
      // We need to create a date object first, then convert
      const tempDate = new Date(dateStr);
      if (isNaN(tempDate.getTime())) {
        logger.warn({
          operation: 'convert_local_time_parse_error',
          message: 'Failed to parse time string',
          context: { timeString, airportCode, timezone },
        });
        return null;
      }
      // Convert from airport timezone to UTC
      localDate = fromZonedTime(tempDate, timezone);
    }

    return localDate.toISOString();
  } catch (error) {
    logger.error({
      operation: 'convert_local_time_to_utc_error',
      message: 'Failed to convert local time to UTC',
      context: { timeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Convert UTC time to local airport time
 * @param utcTimeString UTC time string (ISO format)
 * @param airportCode IATA or ICAO code of the airport
 * @returns Local time ISO string or null if conversion fails
 */
export async function convertUtcToLocalTime(
  utcTimeString: string | null | undefined,
  airportCode: string | null | undefined
): Promise<string | null> {
  if (!utcTimeString || !airportCode) {
    return null;
  }

  try {
    const timezone = await getAirportTimezone(airportCode);
    if (!timezone) {
      return utcTimeString; // Return as-is if no timezone found
    }

    const utcDate = new Date(utcTimeString);
    if (isNaN(utcDate.getTime())) {
      return null;
    }

    // Convert UTC to airport's local timezone
    const localDate = toZonedTime(utcDate, timezone);
    return localDate.toISOString();
  } catch (error) {
    logger.error({
      operation: 'convert_utc_to_local_time_error',
      message: 'Failed to convert UTC to local time',
      context: { utcTimeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Convert Aviationstack API time to UTC
 * Aviationstack returns times in local airport time without timezone info
 * @param timeString Time string from Aviationstack API
 * @param airportCode IATA or ICAO code of the airport
 * @returns UTC ISO string or original string if conversion fails
 */
export async function convertAviationstackTimeToUtc(
  timeString: string | null | undefined,
  airportCode: string | null | undefined
): Promise<string | null> {
  if (!timeString || !airportCode) {
    return null;
  }

  // Aviationstack typically returns times like "2025-12-28T14:30:00" (local time, no timezone)
  // We need to interpret this as local time in the airport's timezone
  try {
    const timezone = await getAirportTimezone(airportCode);
    if (!timezone) {
      logger.warn({
        operation: 'convert_aviationstack_time_no_timezone',
        message: 'No timezone found for airport, cannot convert Aviationstack time',
        context: { airportCode, timeString },
      });
      // Try to parse as UTC as fallback
      const date = new Date(timeString);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }

    // Parse the time string (assume it's in local airport time)
    // Remove any timezone info if present
    let cleanTimeString = timeString;
    if (cleanTimeString.includes('Z')) {
      cleanTimeString = cleanTimeString.replace('Z', '');
    }
    if (cleanTimeString.match(/[+-]\d{2}:\d{2}$/)) {
      cleanTimeString = cleanTimeString.replace(/[+-]\d{2}:\d{2}$/, '');
    }

    // Parse the date components
    // Format is typically "YYYY-MM-DDTHH:mm:ss" or "YYYY-MM-DD HH:mm:ss"
    const dateMatch = cleanTimeString.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
    if (!dateMatch) {
      logger.warn({
        operation: 'convert_aviationstack_time_parse_error',
        message: 'Failed to parse Aviationstack time string format',
        context: { timeString, airportCode, timezone },
      });
      return null;
    }

    // Extract date components
    const [, year, month, day, hour, minute, second] = dateMatch;
    
    // Create a date object with the time components
    // zonedTimeToUtc will interpret this date as if it's in the airport's timezone
    // and convert it to UTC
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10) - 1; // JavaScript months are 0-indexed
    const dayNum = parseInt(day, 10);
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const secondNum = parseInt(second, 10);
    
    // Create a date object using the local time components
    // We create it as if it's in UTC, but zonedTimeToUtc will reinterpret it
    // as if it's in the airport's timezone
    // The key: create the date with UTC components, then zonedTimeToUtc will
    // treat those UTC components as if they were local time in the airport's timezone
    const localDate = new Date(Date.UTC(yearNum, monthNum, dayNum, hourNum, minuteNum, secondNum));
    
    if (isNaN(localDate.getTime())) {
      logger.warn({
        operation: 'convert_aviationstack_time_parse_error',
        message: 'Failed to create date from parsed components',
        context: { timeString, airportCode, timezone, year, month, day, hour, minute, second },
      });
      return null;
    }

    // Convert from airport timezone to UTC
    // fromZonedTime takes a date and interprets its UTC time as if it's in the given timezone,
    // then returns the equivalent UTC date
    // Example: If localDate is 2025-12-28T14:30:00Z (14:30 UTC) and timezone is Europe/Berlin (UTC+1),
    // fromZonedTime will interpret 14:30 UTC as 14:30 Berlin time, which is 13:30 UTC
    // So it returns 2025-12-28T13:30:00Z
    const utcDate = fromZonedTime(localDate, timezone);
    return utcDate.toISOString();
  } catch (error) {
    logger.error({
      operation: 'convert_aviationstack_time_to_utc_error',
      message: 'Failed to convert Aviationstack time to UTC',
      context: { timeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return null;
  }
}

/**
 * Convert AirLabs API time to UTC
 * AirLabs returns times in UTC format, but we should verify
 * @param timeString Time string from AirLabs API (usually UTC)
 * @param airportCode IATA or ICAO code (for fallback conversion if needed)
 * @returns UTC ISO string or original string if already UTC
 */
export async function convertAirlabsTimeToUtc(
  timeString: string | null | undefined,
  airportCode?: string | null | undefined
): Promise<string | null> {
  if (!timeString) {
    return null;
  }

  try {
    // AirLabs API typically returns times in UTC format (with 'Z' suffix or UTC offset)
    // Check if it already has timezone info
    if (timeString.includes('Z') || timeString.match(/[+-]\d{2}:\d{2}$/)) {
      // Already has timezone info, parse and return as UTC
      const date = new Date(timeString);
      return isNaN(date.getTime()) ? null : date.toISOString();
    }

    // If no timezone info, try to convert using airport timezone as fallback
    if (airportCode) {
      return await convertAviationstackTimeToUtc(timeString, airportCode);
    }

    // Last resort: try to parse as UTC
    const date = new Date(timeString);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch (error) {
    logger.error({
      operation: 'convert_airlabs_time_to_utc_error',
      message: 'Failed to convert AirLabs time to UTC',
      context: { timeString, airportCode },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

