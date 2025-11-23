import { parse } from 'node-html-parser';

export interface ParsedBooking {
  airline?: string;
  flightNumber?: string;
  departureCode?: string;
  arrivalCode?: string;
  departureTime?: string;
  arrivalTime?: string;
  pnr?: string;
  seat?: string;
  terminal?: string;
  gate?: string;
  price?: string;
  currency?: string;
  missing: string[];
}

const IATA_REGEX = /\b([A-Z]{3})\b/g;
const FLIGHT_REGEX = /\b([A-Z]{2,3}\s?\d{1,4})\b/;
const PNR_REGEX = /\b([A-Z0-9]{6})\b/;
const ISO_DATE_TIME = /\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\b/;
const EURO_PRICE = /(\d{1,5}[.,]\d{2})\s?(EUR|€)/i;

function extractText(html?: string): string {
  if (!html) return '';
  try {
    const root = parse(html);
    return root.text || '';
  } catch {
    return '';
  }
}

export function parseBookingEmail(subject: string | undefined, text: string | undefined, html?: string): ParsedBooking {
  const source = [subject || '', text || '', extractText(html)].join('\n');
  const missing: string[] = [];

  // Flight number
  const flightMatch = source.match(FLIGHT_REGEX);
  const flightNumber = flightMatch ? flightMatch[1].replace(/\s+/g, '') : undefined;

  // PNR
  const pnrMatch = source.match(PNR_REGEX);
  const pnr = pnrMatch ? pnrMatch[1] : undefined;

  // Airports
  const iatas = Array.from(source.matchAll(IATA_REGEX)).map(m => m[1]);
  const departureCode = iatas[0];
  const arrivalCode = iatas[1];

  // Times (take first 2)
  const timeMatches = Array.from(source.matchAll(ISO_DATE_TIME)).map(m => m[1]);
  const departureTime = timeMatches[0];
  const arrivalTime = timeMatches[1];

  // Seat
  const seatMatch = source.match(/\b([0-9]{1,2}[A-Z])\b/);
  const seat = seatMatch ? seatMatch[1] : undefined;

  // Terminal/Gate (very heuristic)
  const terminalMatch = source.match(/Terminal\s+([A-Za-z0-9]+)/i);
  const gateMatch = source.match(/Gate\s+([A-Za-z0-9]+)/i);

  // Price
  const priceMatch = source.match(EURO_PRICE);
  const price = priceMatch ? priceMatch[1] : undefined;
  const currency = priceMatch ? 'EUR' : undefined;

  const result: ParsedBooking = {
    airline: flightNumber ? flightNumber.slice(0, 2) : undefined,
    flightNumber,
    departureCode,
    arrivalCode,
    departureTime,
    arrivalTime,
    pnr,
    seat,
    terminal: terminalMatch ? terminalMatch[1] : undefined,
    gate: gateMatch ? gateMatch[1] : undefined,
    price,
    currency,
    missing,
  };

  if (!flightNumber) missing.push('flightNumber');
  if (!departureCode) missing.push('departureCode');
  if (!arrivalCode) missing.push('arrivalCode');
  if (!departureTime) missing.push('departureTime');
  if (!arrivalTime) missing.push('arrivalTime');

  return result;
}
