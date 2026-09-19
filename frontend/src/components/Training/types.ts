/**
 * Shared types for Training Annotation components
 */

export interface Flight {
  flightNumber?: string;
  airline?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureDate?: string; // Format: YYYY-MM-DD
  departureTime?: string; // Format: HH:MM
  arrivalDate?: string; // Format: YYYY-MM-DD
  arrivalTime?: string; // Format: HH:MM
  pnr?: string;
  aircraft?: string;
  seat?: string;
  seatClass?: string;
  gate?: string;
  terminal?: string;
  ticketNumber?: string;
  boardingGroup?: string;
  [key: string]: string | undefined;
}

/**
 * Get color class for flight index (for highlighting annotations).
 * Training annotation UI needs visually distinct row tints so the user
 * can track multiple flights in a single email at a glance. Previous
 * palette (blue, green, orange, purple, red) leaked Cruise / Train /
 * Hotel domain colours into a flight-only training surface — per
 * BRAND.md §3 those domain colours stay in their domain. New palette
 * cycles through brand-amber tints + slate + warm orange — all outside
 * the domain reservation list.
 */
export function getFlightColorClass(flightIndex: number): string {
  // The chart palette: this is a categorical series with no domain — "which
  // flight does this token belong to" — which is exactly what `chartColors`
  // is for. It replaces four hand-picked Tailwind tints that each carried a
  // `dark:` twin in an app with no light mode.
  const colors = [
    "bg-(--ts-chart-1)/30",
    "bg-(--ts-chart-2)/30",
    "bg-(--ts-chart-3)/30",
    "bg-(--ts-chart-4)/30",
  ];
  return colors[flightIndex % colors.length] || "bg-(--ts-chart-muted-bar)";
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
const MONTH_NAME_MAP: Record<string, string> = {
  januar: "01",
  january: "01",
  jan: "01",
  februar: "02",
  february: "02",
  feb: "02",
  märz: "03",
  maerz: "03",
  march: "03",
  mar: "03",
  mär: "03",
  april: "04",
  apr: "04",
  mai: "05",
  may: "05",
  juni: "06",
  june: "06",
  jun: "06",
  juli: "07",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  oktober: "10",
  october: "10",
  okt: "10",
  oct: "10",
  november: "11",
  nov: "11",
  dezember: "12",
  december: "12",
  dez: "12",
  dec: "12",
};

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

  // Written month name: "17. Oktober 2023", "17 Oct 2023", "October 17, 2023", "17. Oct 2023 14:30"
  const monthNameMatch = t.match(
    /^(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]{3,9})\.?\s+(\d{4})(?:\s+(\d{1,2}:\d{2}))?/i
  );
  if (monthNameMatch) {
    const [, d, monthStr, y, time] = monthNameMatch;
    const m = MONTH_NAME_MAP[monthStr.toLowerCase()];
    if (m) {
      return {
        date: `${y}-${m}-${d.padStart(2, "0")}`,
        ...(time ? { time: time.padStart(5, "0") } : {}),
      };
    }
  }

  // "October 17, 2023" or "Oktober 17, 2023"
  const monthFirstMatch = t.match(
    /^([A-Za-zäöüÄÖÜ]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}:\d{2}))?/i
  );
  if (monthFirstMatch) {
    const [, monthStr, d, y, time] = monthFirstMatch;
    const m = MONTH_NAME_MAP[monthStr.toLowerCase()];
    if (m) {
      return {
        date: `${y}-${m}-${d.padStart(2, "0")}`,
        ...(time ? { time: time.padStart(5, "0") } : {}),
      };
    }
  }

  // Time only: 14:30, 14:30:00, 14:30 Uhr, 2:30 PM
  const timeMatch = t.match(/^(\d{1,2}:\d{2})(?::\d{2})?(?:\s*Uhr)?$/i);
  if (timeMatch) return { time: timeMatch[1].padStart(5, "0") };

  return {};
}
