/**
 * Geospatial utility functions
 * Provides accurate distance calculations using the Haversine formula
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of point 1 (degrees)
 * @param lon1 Longitude of point 1 (degrees)
 * @param lat2 Latitude of point 2 (degrees)
 * @param lon2 Longitude of point 2 (degrees)
 * @returns Distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}

/**
 * Calculate flight duration in minutes
 * @param departureTime ISO datetime string
 * @param arrivalTime ISO datetime string
 * @returns Duration in minutes
 */
export function calculateFlightDuration(
  departureTime: string,
  arrivalTime: string
): number {
  const departure = new Date(departureTime).getTime();
  const arrival = new Date(arrivalTime).getTime();
  return (arrival - departure) / 60000; // Convert ms to minutes
}

/**
 * Calculate flight duration in hours (formatted)
 * @param departureTime ISO datetime string
 * @param arrivalTime ISO datetime string
 * @returns Duration in hours with 1 decimal place
 */
export function calculateFlightDurationHours(
  departureTime: string,
  arrivalTime: string
): number {
  const minutes = calculateFlightDuration(departureTime, arrivalTime);
  return Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal
}

/**
 * Convert a local time string to UTC timestamp considering timezone
 * @param localTime ISO datetime string (assumed to represent local time in the given timezone, e.g., "2025-05-23T10:25:00")
 * @param timezone IANA timezone string (e.g., "Europe/Berlin", "Asia/Tokyo")
 * @returns UTC timestamp in milliseconds
 */
function localTimeToUTC(localTime: string, timezone: string): number {
  // Parse the ISO string to extract date/time components
  const match = localTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(?:Z|([+-]\d{2}):(\d{2}))?$/);
  if (!match) {
    // Fallback: treat as UTC
    return new Date(localTime).getTime();
  }

  const [, year, month, day, hour, minute, second] = match;
  const yearNum = parseInt(year);
  const monthNum = parseInt(month) - 1; // Month is 0-indexed
  const dayNum = parseInt(day);
  const hourNum = parseInt(hour);
  const minuteNum = parseInt(minute);
  const secondNum = parseInt(second || '0');

  // Strategy: Create a date that when formatted in the timezone gives us the desired local time
  // We'll use an iterative approach: start with a guess and adjust
  
  // Start with the assumption that the local time is at noon UTC on that date
  // This gives us a reasonable starting point
  let guessUTC = Date.UTC(yearNum, monthNum, dayNum, 12, 0, 0);
  
  // Format this guess in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // Iterate to find the correct UTC time
  // We'll adjust the guess until the formatted time matches our target
  for (let i = 0; i < 10; i++) { // Max 10 iterations
    const parts = formatter.formatToParts(new Date(guessUTC));
    const tzYear = parseInt(parts.find(p => p.type === 'year')?.value || '0');
    const tzMonth = parseInt(parts.find(p => p.type === 'month')?.value || '0');
    const tzDay = parseInt(parts.find(p => p.type === 'day')?.value || '0');
    const tzHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const tzMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const tzSecond = parseInt(parts.find(p => p.type === 'second')?.value || '0');

    // Check if we have a match (allowing for day differences due to timezone)
    const targetTotalMinutes = hourNum * 60 + minuteNum;
    const tzTotalMinutes = tzHour * 60 + tzMinute;
    const diffMinutes = targetTotalMinutes - tzTotalMinutes;

    // Check day match
    const dayMatch = tzYear === yearNum && tzMonth === (monthNum + 1) && tzDay === dayNum;
    
    if (Math.abs(diffMinutes) < 1 && dayMatch) {
      // Close enough, adjust for seconds
      const secondDiff = secondNum - tzSecond;
      return guessUTC + (secondDiff * 1000);
    }

    // Adjust the guess
    guessUTC += diffMinutes * 60 * 1000;
    
    // If day doesn't match, adjust by a day
    if (!dayMatch) {
      if (tzDay < dayNum || (tzDay === dayNum && tzMonth < (monthNum + 1)) || (tzDay === dayNum && tzMonth === (monthNum + 1) && tzYear < yearNum)) {
        guessUTC += 24 * 60 * 60 * 1000;
      } else {
        guessUTC -= 24 * 60 * 60 * 1000;
      }
    }
  }

  // If iteration didn't converge, return the last guess
  return guessUTC;
}

/**
 * Calculate flight duration considering airport timezones
 * This correctly handles cases where departure and arrival are in different timezones
 * 
 * The input times are ISO datetime strings that represent local times at the airports.
 * We need to convert them to UTC first, then calculate the difference.
 * 
 * @param departureTime ISO datetime string (local time at departure airport, e.g., "2025-05-23T10:25:00")
 * @param arrivalTime ISO datetime string (local time at arrival airport, e.g., "2025-05-24T05:15:00")
 * @param departureTimezone IANA timezone string (e.g., "Europe/Berlin")
 * @param arrivalTimezone IANA timezone string (e.g., "Asia/Tokyo")
 * @returns Duration in minutes
 */
export function calculateFlightDurationWithTimezone(
  departureTime: string,
  arrivalTime: string,
  departureTimezone?: string | null,
  arrivalTimezone?: string | null
): number {
  // If timezones are not available, fall back to simple calculation
  if (!departureTimezone || !arrivalTimezone) {
    return calculateFlightDuration(departureTime, arrivalTime);
  }

  try {
    // Convert local times to UTC timestamps
    const depUTC = localTimeToUTC(departureTime, departureTimezone);
    const arrUTC = localTimeToUTC(arrivalTime, arrivalTimezone);
    
    // Calculate duration in minutes
    return (arrUTC - depUTC) / 60000;
  } catch (error) {
    // If timezone conversion fails, fall back to simple calculation
    console.warn('Failed to calculate flight duration with timezones, using fallback:', error);
    return calculateFlightDuration(departureTime, arrivalTime);
  }
}

/**
 * Calculate flight duration in hours considering airport timezones
 * @param departureTime ISO datetime string (local time at departure airport)
 * @param arrivalTime ISO datetime string (local time at arrival airport)
 * @param departureTimezone IANA timezone string (e.g., "Europe/Berlin")
 * @param arrivalTimezone IANA timezone string (e.g., "Asia/Tokyo")
 * @returns Duration in hours with 1 decimal place
 */
export function calculateFlightDurationHoursWithTimezone(
  departureTime: string,
  arrivalTime: string,
  departureTimezone?: string | null,
  arrivalTimezone?: string | null
): number {
  const minutes = calculateFlightDurationWithTimezone(
    departureTime,
    arrivalTime,
    departureTimezone,
    arrivalTimezone
  );
  return Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal
}