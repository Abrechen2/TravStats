import { parseAmount } from "../../lodging/documentTotal";
import type { RailTravelClassValue } from "./types";

/**
 * Small readers every rail template shares: German dates and times, amounts,
 * the class, and the one train-number shape a ticket prints.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** A real calendar day as `YYYY-MM-DD`, or null — "31.02." is not a day. */
export function isoDay(day: number, month: number, year: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "14.06.2025" or "21.03.08" → `2025-06-14`; a two-digit year is 20YY. */
export function germanDate(text: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(text.trim());
  if (!match) return null;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return isoDay(Number(match[1]), Number(match[2]), year);
}

/** "9:05" / "09:05" → `09:05`, or null for "25:00". */
export function clockTime(text: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** A day and a clock as the rail write path takes them: `YYYY-MM-DDTHH:mm`. */
export function wallClock(day: string | null, time: string | null): string | null {
  return day && time ? `${day}T${time}` : null;
}

/** "3,20 EUR", "122,50€", "€ 1.234,50" → the number; null without a digit. */
export function amountOf(text: string): number | null {
  if (!/\d/.test(text)) return null;
  const value = parseAmount(text);
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

/** "EUR", "€", "CHF", "Fr." → ISO 4217; null for anything else. */
export function currencyOf(text: string): string | null {
  if (/€|\bEUR\b|\bEuro\b/i.test(text)) return "EUR";
  if (/\bCHF\b|\bSFr\.?|\bFr\.\s/.test(text)) return "CHF";
  if (/£|\bGBP\b/.test(text)) return "GBP";
  if (/\bCZK\b|\bKč\b/.test(text)) return "CZK";
  if (/\bPLN\b|\bzł\b/.test(text)) return "PLN";
  if (/\bDKK\b/.test(text)) return "DKK";
  if (/\bSEK\b/.test(text)) return "SEK";
  if (/\bHUF\b/.test(text)) return "HUF";
  return null;
}

/** "2. Klasse", "Klasse: 1", "1. Kl.", "2nd class", "1re classe" → the class. */
export function travelClassOf(raw: string): RailTravelClassValue | null {
  // "BahnCard 50 (1. Klasse)" is the discount card's class, not the ticket's.
  const text = raw.replace(/BahnCard[^,\n()]{0,20}\([12]\.\s*Klasse\)/gi, "");
  const match =
    /\b([12])\.\s*(?:Klasse|Kl\.)/i.exec(text) ??
    /\bKlasse:?\s*([12])\b/i.exec(text) ??
    /\b([12])(?:st|nd)\s+class\b/i.exec(text) ??
    /\b([12])(?:re|e|nde)\s+classe\b/i.exec(text);
  if (!match) return null;
  return match[1] === "1" ? "first" : "second";
}

/**
 * The categories a train number is printed with. Kept to categories a ticket
 * actually prints, so "Kundennummer 123456" or "HRB 83 173" can never read as
 * a train: the token must stand on its own and name a real product.
 */
const TRAIN_CATEGORIES = [
  "ICE",
  "ECE",
  "IC",
  "EC",
  "EN",
  "NJ",
  "CNL",
  "IRE",
  "RE",
  "RB",
  "S",
  "TGV",
  "RJX",
  "RJ",
  "WB",
  "FLX",
  "IR",
  "ALX",
  "BRB",
  "MEX",
  "M",
  "ERB",
  "HLB",
  "NWB",
  "ICN",
  "EST",
  "TER",
  "OUIGO",
] as const;

const TRAIN_TOKEN = new RegExp(`\\b(${TRAIN_CATEGORIES.join("|")})\\s?(\\d{1,6})\\b`);

export interface TrainToken {
  category: string;
  number: string;
}

/** The first train token in `text`, exactly as printed; null when there is none. */
export function trainTokenIn(text: string): TrainToken | null {
  const match = TRAIN_TOKEN.exec(text);
  return match ? { category: match[1], number: match[2] } : null;
}

/** True when `text` names any train at all — the LLM prompt asks for one only then. */
export function mentionsTrain(text: string): boolean {
  return TRAIN_TOKEN.test(text);
}

/**
 * A station as printed, tidied: DB appends platform areas ("München Hbf
 * Gl.5-10") and abbreviating dots; neither is part of the station's name.
 */
export function cleanStationName(raw: string): string {
  return raw
    .replace(/\s+Gl\.\s*[\d-]+$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
