import logger from "../../../utils/logger";
import { cleanStationName, clockTime, trainTokenIn, wallClock, isoDay } from "./ticketText";
import type { ParsedRailLeg } from "./types";

/**
 * The calendar file a DB booking mail carries ("BAHN_Fahrplan.ics", later
 * "BAHN_<date>_Hinfahrt_.ics") — RFC 5545, one VEVENT per direction.
 *
 * What was VERIFIED against real files (a private corpus, 2012–2015):
 *   SUMMARY:Kiel Hbf -> Bremen Hbf                  (the layout; stations invented)
 *   DTSTART;TZID=Europe/Berlin:20260314T080500      (one generation wrote
 *                                                    "Europe//Berlin")
 *   DESCRIPTION:Reise: A nach B\nDatum: …\n\nab A 08:05\nan B 10:43\n…
 * and that none of those files named a train, and some were latin1.
 *
 * What is a HYPOTHESIS, because no such file was available: a newer file whose
 * SUMMARY or DESCRIPTION carries the train ("ICE 578 München Hbf → Berlin
 * Hbf"). The reader copies a train token from there when one stands there,
 * and never otherwise.
 *
 * A UTC time ("…T073700Z") is skipped rather than read: which station clock it
 * should be shown on is exactly what this reader cannot know, and a leg an
 * hour off is worse than a leg the user adds by hand.
 */

/** Bytes as text: UTF-8 when they are valid UTF-8, latin1 otherwise. */
export function decodeCalendar(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString("latin1");
  }
}

/** RFC 5545 §3.1: a line starting with a space or tab continues the one before. */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

/** §3.3.11 TEXT escapes. */
function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

interface RawEvent {
  summary?: string;
  description?: string;
  dtstart?: string;
  dtend?: string;
}

function eventsOf(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  let current: RawEvent | null = null;
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT$/i.test(line.trim())) current = {};
    else if (/^END:VEVENT$/i.test(line.trim())) {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const name = line.slice(0, colon).split(";")[0].toUpperCase();
      const value = line.slice(colon + 1);
      if (name === "SUMMARY") current.summary = unescapeText(value);
      else if (name === "DESCRIPTION") current.description = unescapeText(value);
      else if (name === "DTSTART") current.dtstart = value.trim();
      else if (name === "DTEND") current.dtend = value.trim();
    }
  }
  return events;
}

/** `20260314T080500` (floating or TZID) → a wall clock; a UTC value → null. */
function localTime(value: string | undefined): string | null {
  const match = value ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}$/.exec(value) : null;
  if (!match) return null;
  return wallClock(
    isoDay(Number(match[3]), Number(match[2]), Number(match[1])),
    clockTime(`${match[4]}:${match[5]}`)
  );
}

const SUMMARY_ROUTE = /^(?:.*?\b(?:ICE|IC|EC|RE|RB|S)\s?\d+\s+)?(.+?)\s*(?:->|→)\s*(.+?)\s*$/;

export function parseCalendarLegs(text: string): ParsedRailLeg[] {
  const legs: ParsedRailLeg[] = [];
  for (const event of eventsOf(text)) {
    const route = event.summary ? SUMMARY_ROUTE.exec(event.summary) : null;
    if (!route) continue;
    const departureLocal = localTime(event.dtstart);
    if (!departureLocal) {
      logger.info(
        { operation: "rail_ics_event_skipped", hasStart: Boolean(event.dtstart) },
        "[Rail Parser] Calendar event without a local start time — skipped"
      );
      continue;
    }
    // The description's "ab X" / "an Y" names the stations as DB spells them.
    const ab = /^ab\s+(.+?)\s+\d{1,2}:\d{2}\s*$/m.exec(event.description ?? "");
    const an = /^an\s+(.+?)\s+\d{1,2}:\d{2}\s*$/m.exec(event.description ?? "");
    const train = trainTokenIn(`${event.summary ?? ""}\n${event.description ?? ""}`);
    legs.push({
      depStationName: cleanStationName(ab?.[1] ?? route[1]),
      arrStationName: cleanStationName(an?.[1] ?? route[2]),
      departureLocal,
      arrivalLocal: localTime(event.dtend),
      trainCategory: train?.category ?? null,
      trainNumber: train?.number ?? null,
      coach: null,
      seat: null,
      direction: null,
    });
  }
  return legs;
}

export function isCalendarAttachment(filename: string | undefined, mediaType: string): boolean {
  return /\.ics$/i.test(filename ?? "") || /text\/calendar|application\/ics/i.test(mediaType);
}
