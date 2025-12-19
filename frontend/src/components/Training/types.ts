/**
 * Shared types for Training Annotation components
 */

export interface Flight {
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureDate?: string;      // Format: YYYY-MM-DD
  departureTime?: string;       // Format: HH:MM
  arrivalDate?: string;         // Format: YYYY-MM-DD
  arrivalTime?: string;         // Format: HH:MM
  pnr?: string;
  aircraftType?: string;        // Statt price
  seat?: string;
  gate?: string;
  terminal?: string;
  [key: string]: any;           // Für zusätzliche Felder
}

/**
 * Get color class for flight index (for highlighting annotations)
 */
export function getFlightColorClass(flightIndex: number): string {
  const colors = [
    'bg-blue-300 dark:bg-blue-700',
    'bg-green-300 dark:bg-green-700',
    'bg-orange-300 dark:bg-orange-700',
    'bg-purple-300 dark:bg-purple-700',
  ];
  return colors[flightIndex % colors.length] || 'bg-red-300 dark:bg-red-700';
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
 * Split ISO 8601 datetime string into date and time
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
