/**
 * Date and time extraction logic for the regex parser.
 * Handles ISO dates, German/English date formats, labelled dates,
 * next-day markers, and standalone "Uhr" times.
 */

import { MONTH_NAMES } from './regexMappings';

/** Add N calendar days to an ISO datetime string (YYYY-MM-DDTHH:MM) */
export function addDays(iso: string, days: number): string {
  const tIdx = iso.indexOf('T');
  const datePart = tIdx >= 0 ? iso.slice(0, tIdx) : iso;
  const timePart = tIdx >= 0 ? iso.slice(tIdx + 1) : '00:00';
  const [y, m, d] = datePart.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}T${timePart}`;
}

/** Extract all date/time pairs from text (positional, multi-flight) */
export function extractAllTimePairs(source: string): Array<{ departure?: string; arrival?: string }> {
  const pairs: Array<{ departure?: string; arrival?: string }> = [];

  // ISO format dates — TZ offset/Z suffix is consumed but not captured (local time kept)
  const isoPattern = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?(?=[^\d]|$)/g;
  const isoMatches = Array.from(source.matchAll(isoPattern));
  const isoDates = isoMatches.map(m => m[1].replace(' ', 'T'));

  // Group into pairs (departure, arrival)
  for (let i = 0; i < isoDates.length; i += 2) {
    pairs.push({
      departure: isoDates[i],
      arrival: isoDates[i + 1],
    });
  }

  // High-priority: "Datum der Abreise DD.MM.YYYY Abflugzeit HH:MM"
  // New Lufthansa format — date and time separated by a keyword on the same line.
  // Each occurrence is a separate flight segment departure.
  const datumAbflugPattern = /Datum\s+der\s+Abreise\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s+Abflugzeit\s+(\d{1,2}):(\d{2})/gi;
  for (const m of source.matchAll(datumAbflugPattern)) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}`;
    pairs.push({ departure: iso });
  }

  // If "Datum der Abreise" found all segments, return now — generic German date scanning
  // would corrupt arrivals by matching dates that are actually departure repeats.
  if (pairs.length > 0) return pairs;

  // German/English date format — abbreviated and full month names, time optional
  // Also handles dash-separated time: "18.09.2025 - 08:25"
  const germanPattern = /(\d{1,2})[.\s]+(\d{1,2}|[A-Za-zÄÖÜäöü]{3,9})[.\s]+(\d{4})(?:[,\s]+(?:-\s*)?(\d{1,2}):(\d{2}))?/gi;
  const germanMatches = Array.from(source.matchAll(germanPattern));

  for (const match of germanMatches) {
    const day = match[1].padStart(2, '0');
    const raw = match[2].toUpperCase();
    const month = MONTH_NAMES[raw] ?? (match[2].length <= 2 ? match[2].padStart(2, '0') : '01');
    const year = match[3];
    const hour = match[4] ? match[4].padStart(2, '0') : '00';
    const minute = match[5] ?? '00';
    let isoTime = `${year}-${month}-${day}T${hour}:${minute}`;

    // Detect +N next-day marker (e.g. "+1", "(+1)") — exclude timezone offsets like +01:00
    const after = source.slice(match.index! + match[0].length, match.index! + match[0].length + 8);
    const nextDay = after.match(/^\s*\(?\+(\d)\)?(?!\d*:)/);
    if (nextDay) isoTime = addDays(isoTime, Number(nextDay[1]));

    // Add to pairs: first German date becomes departure, second becomes arrival of same pair
    const existingPair = pairs.find(p => p.departure && !p.arrival);
    if (existingPair) {
      existingPair.arrival = isoTime;
    } else {
      pairs.push({ departure: isoTime });
    }
  }

  return pairs;
}

/**
 * Scan source for dep/arr label keywords immediately followed by a parseable date.
 * Returns whichever of {departureTime, arrivalTime} it finds.
 * Caller uses positional fallback for any field not found here.
 */
export function extractLabeledDates(source: string): { departureTime?: string; arrivalTime?: string } {
  const result: { departureTime?: string; arrivalTime?: string } = {};

  // Strategy A: new Lufthansa format — "Abflug - Datum: 06 Jun 2025\n  Zeit: 09:30"
  // Match "Abflug[-]Datum:" and "Ankunft[-]Datum:" blocks, then look for Zeit: nearby.
  const datumZeitPattern =
    /(?:Abflug|Departure)\s*[-–]\s*(?:Datum|Date)\s*:?\s*([\w\s.]+?)\s*\n(?:[^\n]*\n)?\s*Zeit\s*:?\s*(\d{1,2}:\d{2})/gi;
  const datumZeitArrPattern =
    /(?:Ankunft|Arrival)\s*[-–]\s*(?:Datum|Date)\s*:?\s*([\w\s.]+?)\s*\n(?:[^\n]*\n)?\s*Zeit\s*:?\s*(\d{1,2}:\d{2})/gi;

  const parseDateTimePair = (dateStr: string, timeStr: string): string | undefined => {
    const m = dateStr.trim().match(/^(\d{1,2})[.\s]+([A-Za-zÄÖÜäöü]{3,9}|\d{1,2})[.\s]+(\d{4})$/);
    if (!m) return undefined;
    const d = m[1].padStart(2, '0');
    const raw = m[2].toUpperCase();
    const mo = MONTH_NAMES[raw] ?? (m[2].length <= 2 ? m[2].padStart(2, '0') : undefined);
    if (!mo) return undefined;
    const h = timeStr.split(':')[0].padStart(2, '0');
    const min = timeStr.split(':')[1] ?? '00';
    return `${m[3]}-${mo}-${d}T${h}:${min}`;
  };

  for (const m of source.matchAll(datumZeitPattern)) {
    const iso = parseDateTimePair(m[1], m[2]);
    if (iso) { result.departureTime = iso; break; }
  }
  for (const m of source.matchAll(datumZeitArrPattern)) {
    const iso = parseDateTimePair(m[1], m[2]);
    if (iso) { result.arrivalTime = iso; break; }
  }

  if (result.departureTime && result.arrivalTime) return result;

  // Strategy B: label-based parsing for combined datetime or date-only labels.
  // DEP_LABELS: The lookahead (?=\s*:|\s+\d|\s+[A-Za-zÄÖÜäöü]{3}) on "Dep"/"Arr" is zero-width
  // (not consumed). The trailing \s*:?\s* then consumes the actual separator.
  const DEP_LABELS =
    /(?:Abflug(?!\s*[-–]\s*(?:Datum|Ort))|Abflugzeit|Abflugszeit|Datum\s+der\s+Abreise|Abreise|Departure(?:\s*Date)?|Departing|Departs|Dep(?=\s*:|\s+\d|\s+[A-Za-zÄÖÜäöü]{3}))\s*:?\s*/gi;
  const ARR_LABELS =
    /(?:Ankunft(?!\s*[-–]\s*(?:Datum|Ort))|Ankunftszeit|Arrival|Arriving|Arrives|Arr(?=\s*:|\s+\d|\s+[A-Za-zÄÖÜäöü]{3}))\s*:?\s*/gi;

  const parseFromPos = (pos: number): string | undefined => {
    const slice = source.slice(pos, pos + 60);
    // ISO format (TZ suffix stripped)
    const isoM = slice.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)(?:[+-]\d{2}:?\d{2}|Z)?/);
    if (isoM) {
      const iso = isoM[1].replace(' ', 'T');
      const afterIso = slice.slice(isoM[0].length, isoM[0].length + 8);
      const nextDay = afterIso.match(/^\s*\(?\+(\d)\)?(?!\d*:)/);
      return nextDay ? addDays(iso, Number(nextDay[1])) : iso;
    }
    // German/English date format (time optional, dash or comma separator, "Uhr" suffix)
    const deM = slice.match(
      /^(\d{1,2})[.\s]+(\d{1,2}|[A-Za-zÄÖÜäöü]{3,9})[.\s]+(\d{4})(?:[,\s]+(?:-\s*)?(\d{1,2}):(\d{2})(?:\s*Uhr)?)?/
    );
    if (deM) {
      const d = deM[1].padStart(2, '0');
      const raw = deM[2].toUpperCase();
      const mo = MONTH_NAMES[raw] ?? (deM[2].length <= 2 ? deM[2].padStart(2, '0') : '01');
      const h = deM[4] ? deM[4].padStart(2, '0') : '00';
      const min = deM[5] ?? '00';
      let iso = `${deM[3]}-${mo}-${d}T${h}:${min}`;
      const afterDate = slice.slice(deM[0].length, deM[0].length + 8);
      const nextDay = afterDate.match(/^\s*\(?\+(\d)\)?(?!\d*:)/);
      if (nextDay) iso = addDays(iso, Number(nextDay[1]));
      return iso;
    }
    // Weekday prefix "So. 22. Oktober..." — skip weekday and retry
    const weekdayPrefixM = slice.match(/^[A-Za-z]{2,3}\.\s+/);
    if (weekdayPrefixM) {
      return parseFromPos(pos + weekdayPrefixM[0].length);
    }
    return undefined;
  };

  if (!result.departureTime) {
    for (const m of source.matchAll(DEP_LABELS)) {
      const t = parseFromPos(m.index! + m[0].length);
      if (t) { result.departureTime = t; break; }
    }
  }

  if (!result.arrivalTime) {
    for (const m of source.matchAll(ARR_LABELS)) {
      const pos = m.index! + m[0].length;
      const slice = source.slice(pos, pos + 20);
      // Time-only arrival (e.g. "Ankunft: 19:05 Uhr") — combine with departure date
      const timeOnly = slice.match(/^(\d{1,2}:\d{2})(?:\s*Uhr)?/);
      if (timeOnly && result.departureTime) {
        const depDate = result.departureTime.slice(0, 10); // YYYY-MM-DD
        result.arrivalTime = `${depDate}T${timeOnly[1].padStart(5, '0')}`;
        break;
      }
      const t = parseFromPos(pos);
      if (t) { result.arrivalTime = t; break; }
    }
  }

  // Strategy C: standalone "HH:MM Uhr" times (old Buchungsdetails format)
  // When a date was found but T00:00, fill in the real time from "HH:MM Uhr" occurrences.
  const uhrPattern = /(\d{1,2}):(\d{2})\s+Uhr/gi;
  const uhrMatches = [...source.matchAll(uhrPattern)];
  if (uhrMatches.length > 0 && result.departureTime?.endsWith('T00:00')) {
    const h = uhrMatches[0][1].padStart(2, '0');
    const min = uhrMatches[0][2];
    result.departureTime = result.departureTime.slice(0, 11) + `${h}:${min}`;
  }
  if (uhrMatches.length > 1 && result.departureTime && !result.departureTime.endsWith('T00:00')) {
    const h = uhrMatches[1][1].padStart(2, '0');
    const min = uhrMatches[1][2];
    const depDate = result.departureTime.slice(0, 10);
    if (!result.arrivalTime || result.arrivalTime.endsWith('T00:00')) {
      result.arrivalTime = `${depDate}T${h}:${min}`;
    }
  }

  return result;
}
