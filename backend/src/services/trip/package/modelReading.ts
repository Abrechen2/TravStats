/**
 * Reading a package-tour document with the language model — only when the
 * user asks for it (spec 2026-08-21, "As built").
 *
 * `parsePackage.ts` is template-or-nothing on purpose: a misread package is a
 * dozen wrong rows. This is the second, explicit step for a document no
 * template knows. The model's JSON is held to the same contract a template's
 * values are, behind a truthfulness gate: a booking reference, flight number
 * or stay name the document does not contain is not accepted, and what the
 * gate drops is returned so the reviewer sees it. Every failure has its own
 * code and reason; none becomes an empty success.
 */
import logger from "../../../utils/logger";
import { llmParseTimeoutMs } from "../../http/llmTimeout";
import { llmRefusalFor } from "../../llm/llmGate";
import { llmGenerateChain } from "../../llm/llmProvider";
import { canonicalFlightNumber, validatePackageValues, type PackageContract } from "./contract";

/** A row the truthfulness gate refused; the client words it (kind + the value as the model wrote it). */
export interface DroppedRow {
  kind: "bookingReference" | "flight" | "stay" | "price";
  value: string;
}

export type ModelFallbackCode = "modelRefused" | "modelFailed" | "modelInvalid";

export interface ModelPackageResult {
  reading: PackageContract | null;
  fallbackCode?: ModelFallbackCode;
  /** English, for the log and the detail line next to the localized sentence. */
  fallbackReason?: string;
  /** Contract paths the answer failed (`modelInvalid`). */
  issues?: string[];
  /** Rows the truthfulness gate refused. */
  dropped: DroppedRow[];
}

/** Enough for a multi-page itinerary without an unbounded prompt. */
const MAX_DOCUMENT_CHARS = 16_000;

export const PACKAGE_SYSTEM_PROMPT = `You extract ONE travel package booking (a tour operator or travel agency confirmation) into JSON.
Output a single JSON object with exactly these keys; use null for anything the document does not state. Never invent values; copy flight numbers, booking numbers and hotel names exactly as printed.
{
  "bookingReference": string (the operator's booking number, as printed),
  "issuedOn": "YYYY-MM-DD" (date the document was issued or the booking made),
  "tripName": string|null, "startDate": "YYYY-MM-DD"|null, "endDate": "YYYY-MM-DD"|null,
  "travellers": integer|null, "operator": string|null,
  "totalPrice": number|null (the grand total actually charged, never per-person or pre-discount), "currency": "EUR"|"USD"|... (ISO 4217)|null,
  "flights": [{"flightNumber": "LH400", "date": "YYYY-MM-DD" (local departure day), "depIata": "FRA"|null, "arrIata": "JFK"|null, "depCity": string|null, "arrCity": string|null, "depTime": "HH:MM"|null, "arrTime": "HH:MM"|null, "arrDayOffset": integer|null, "airline": string|null}],
  "stays": [{"name": string, "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "address": string|null, "city": string|null, "country": string|null, "board": string|null, "room": string|null}],
  "cruiseShip": string|null, "cruiseFrom": string|null, "cruiseTo": string|null, "cruiseCabin": string|null, "cruiseStart": "YYYY-MM-DD"|null, "cruiseEnd": "YYYY-MM-DD"|null
}
The year of a date is the TRAVEL period, never the print date. Transfers, trains and excursions are not flights or stays: leave them out. Answer with JSON only.`;

const squash = (s: string): string => s.toLowerCase().replace(/[\s\u00a0]+/g, " ");

/** Every flight-number-looking token of the document, in canonical form. */
function flightNumbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text
    .toUpperCase()
    .matchAll(/\b([A-Z][A-Z0-9]|[0-9][A-Z])[\s-]?(\d{1,5}[A-Z]?)\b/g)) {
    const canonical = canonicalFlightNumber(`${m[1]}${m[2]}`);
    if (canonical) found.add(canonical);
  }
  return found;
}

/** True when the amount's digits appear in the document, any separator style. */
function priceAppearsIn(text: string, price: number): boolean {
  const digits = text.replace(/[.,'’\s\u00a0]/g, "");
  const cents = String(Math.round(price * 100));
  return digits.includes(cents) || (Number.isInteger(price) && digits.includes(String(price)));
}

function unwrap(parsed: unknown): Record<string, unknown> | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["package", "booking", "data", "result"]) {
    const inner = obj[key];
    if (
      typeof inner === "object" &&
      inner !== null &&
      !Array.isArray(inner) &&
      !obj.bookingReference
    ) {
      return inner as Record<string, unknown>;
    }
  }
  return obj;
}

function parseJson(raw: string): unknown {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const braces = cleaned.match(/\{[\s\S]*\}/);
    if (!braces) throw new Error("The answer held no JSON object");
    return JSON.parse(braces[0]);
  }
}

/** The truthfulness gate: what the document does not contain is not accepted. */
export function gatePackageAnswer(
  answer: Record<string, unknown>,
  text: string
): { values: Record<string, unknown>; dropped: DroppedRow[] } {
  const dropped: DroppedRow[] = [];
  const haystack = squash(text);
  const values: Record<string, unknown> = { ...answer };

  const reference = typeof answer.bookingReference === "string" ? answer.bookingReference : "";
  if (!reference || !haystack.includes(squash(reference.trim()))) {
    if (reference) dropped.push({ kind: "bookingReference", value: reference });
    delete values.bookingReference;
  }

  const numbers = flightNumbersIn(text);
  values.flights = (Array.isArray(answer.flights) ? answer.flights : []).filter((f) => {
    const raw = (f as { flightNumber?: unknown } | null)?.flightNumber;
    const canonical = typeof raw === "string" ? canonicalFlightNumber(raw) : null;
    if (canonical && numbers.has(canonical)) return true;
    dropped.push({ kind: "flight", value: String(raw) });
    return false;
  });

  values.stays = (Array.isArray(answer.stays) ? answer.stays : []).filter((s) => {
    const name = (s as { name?: unknown } | null)?.name;
    if (typeof name === "string" && haystack.includes(squash(name.trim()))) return true;
    dropped.push({ kind: "stay", value: String(name) });
    return false;
  });

  if (typeof answer.totalPrice === "number" && !priceAppearsIn(text, answer.totalPrice)) {
    dropped.push({ kind: "price", value: String(answer.totalPrice) });
    values.totalPrice = null;
    values.currency = null;
  }
  return { values, dropped };
}

export async function readPackageWithModel(
  text: string,
  userId?: string
): Promise<ModelPackageResult> {
  const refusal = await llmRefusalFor(userId);
  if (refusal) {
    return {
      reading: null,
      fallbackCode: "modelRefused",
      fallbackReason: refusal.reason,
      dropped: [],
    };
  }

  const snippet = text.slice(0, MAX_DOCUMENT_CHARS);
  let raw: string;
  try {
    ({ text: raw } = await llmGenerateChain({
      ...(userId !== undefined ? { userId } : {}),
      system: PACKAGE_SYSTEM_PROMPT,
      prompt: `Extract the package booking from this document.\n\nDOCUMENT:\n${snippet}`,
      temperature: 0,
      json: true,
      timeoutMs: llmParseTimeoutMs(),
    }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ err: reason }, "[Package] Model reading failed");
    return {
      reading: null,
      fallbackCode: "modelFailed",
      fallbackReason: `The AI parser failed: ${reason}`,
      dropped: [],
    };
  }

  let answer: Record<string, unknown> | null;
  try {
    answer = unwrap(parseJson(raw));
  } catch (err) {
    answer = null;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[Package] Model answer is not JSON"
    );
  }
  if (!answer) {
    return {
      reading: null,
      fallbackCode: "modelInvalid",
      fallbackReason: "The AI answer was not a package object",
      issues: ["(root): not a JSON object"],
      dropped: [],
    };
  }

  const { values, dropped } = gatePackageAnswer(answer, snippet);
  const checked = validatePackageValues(values);
  if (!checked.ok) {
    return {
      reading: null,
      fallbackCode: "modelInvalid",
      fallbackReason: "The AI answer does not satisfy the package contract",
      issues: checked.issues,
      dropped,
    };
  }
  return { reading: checked.contract, dropped };
}
