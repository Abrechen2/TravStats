/**
 * Shared types for Training Annotation components
 */

export interface Flight {
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureDate?: string; // Format: YYYY-MM-DD
  departureTime?: string; // Format: HH:MM
  arrivalDate?: string; // Format: YYYY-MM-DD
  arrivalTime?: string; // Format: HH:MM
  pnr?: string;
  aircraftType?: string; // Statt price
  seat?: string;
  gate?: string;
  terminal?: string;
  [key: string]: string | undefined; // Für zusätzliche Felder
}

/**
 * Get color class for flight index (for highlighting annotations)
 */
export function getFlightColorClass(flightIndex: number): string {
  const colors = [
    "bg-blue-300 dark:bg-blue-700",
    "bg-green-300 dark:bg-green-700",
    "bg-orange-300 dark:bg-orange-700",
    "bg-purple-300 dark:bg-purple-700",
  ];
  return colors[flightIndex % colors.length] || "bg-red-300 dark:bg-red-700";
}

/**
 * Combine date and time to ISO 8601 format
 */
export function combineDateTime(date?: string, time?: string): string | undefined {
  if (!date) return undefined;
  if (!time) return date; // Just date if no time
  return `${date}T${time}:00`;
}

/**
 * Split ISO 8601 datetime string into date and time.
 * Used for loading previously saved ISO values back into the form.
 */
export function splitDateTime(dateTime?: string): { date?: string; time?: string } {
  if (!dateTime) return { date: undefined, time: undefined };

  // Handle ISO 8601 format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM
  const match = dateTime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) {
    return { date: match[1], time: match[2] };
  }

  // Fallback: assume it's just a date
  if (dateTime.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return { date: dateTime, time: undefined };
  }

  return { date: undefined, time: undefined };
}

/**
 * Parse raw text from email annotation into form-compatible date/time values.
 * Handles common formats found in booking confirmation emails.
 * Returns values in YYYY-MM-DD and HH:MM format suitable for <input type="date/time">.
 */
export function parseAnnotationText(text: string): { date?: string; time?: string } {
  const t = text.trim();

  // ISO combined: 2024-03-18T14:30 or 2024-03-18T14:30:00
  const isoCombined = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (isoCombined) return { date: isoCombined[1], time: isoCombined[2] };

  // German combined: 18.03.2024 14:30 or 18.3.2024 14:30
  const germanCombined = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}:\d{2})/);
  if (germanCombined) {
    const [, d, m, y, time] = germanCombined;
    return {
      date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`,
      time: time.padStart(5, "0"),
    };
  }

  // German date only: 18.03.2024 or 18.3.2024
  const germanDate = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (germanDate) {
    const [, d, m, y] = germanDate;
    return { date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` };
  }

  // ISO date only: 2024-03-18
  if (t.match(/^\d{4}-\d{2}-\d{2}$/)) return { date: t };

  // Time only: 14:30, 14:30:00, 14:30 Uhr, 2:30 PM
  const timeMatch = t.match(/^(\d{1,2}:\d{2})(?::\d{2})?(?:\s*Uhr)?$/i);
  if (timeMatch) return { time: timeMatch[1].padStart(5, "0") };

  return {};
}
