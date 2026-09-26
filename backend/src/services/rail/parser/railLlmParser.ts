import { z } from "zod";

import logger from "../../../utils/logger";
import { requestTextWithDeadline } from "../../http/boundedHttp";
import {
  LLM_AVAILABILITY_TIMEOUT_MS,
  LLM_MAX_RESPONSE_BYTES,
  llmParseTimeoutMs,
} from "../../http/llmTimeout";
import { getAdminParserSettings } from "../../parserSettings";
import { foldStationName } from "../railStations";
import {
  amountOf,
  cleanStationName,
  currencyOf,
  mentionsTrain,
  travelClassOf,
  trainTokenIn,
} from "./ticketText";
import type { ParsedRailBooking, ParsedRailLeg } from "./types";

/**
 * The model, for rail layouts no template knows (ÖBB, SBB, Trainline, SNCF
 * and whatever DB prints next). Two rules from measured failures decide how
 * the prompt is built and what survives the answer:
 *
 *  1. A prompt names only what the document can carry. A field named in the
 *     prompt and absent from the text is an instruction the model fulfils by
 *     inventing it (trip summaries, 18.09.: invented "notes" labelled with the
 *     field's own name). So the train, coach/seat, price and reference fields
 *     are asked for ONLY when the text shows something of that kind — they are
 *     left out, not forbidden, because a forbidding sentence introduces the
 *     word it forbids.
 *  2. A model's field is a sample, not a measurement (lodging, 16.08.: one
 *     receipt, two prices). Every copied value is checked against the text: a
 *     train number, a reference or a station that does not stand in the
 *     document is dropped, and an amount is only kept when that amount is
 *     printed there.
 */

const LLM_TEXT_MAX_CHARS = 12_000;

/** What the document shows — and therefore what the prompt may ask for. */
export interface RailPromptFields {
  train: boolean;
  seat: boolean;
  price: boolean;
  reference: boolean;
}

export function promptFieldsFor(text: string): RailPromptFields {
  return {
    train: mentionsTrain(text),
    seat: /\b(Wagen|Wg\.|Platz|Pl\.|coach|seat|voiture|place|carrozza|posto)\b/i.test(text),
    price: /\d[\d.,]*\s?(€|EUR|CHF|GBP|£)|(€|EUR|CHF|£)\s?\d/i.test(text),
    reference:
      /\b(Auftragsnummer|Buchungsnummer|Buchungscode|Reservierungsnummer|booking reference|reference|PNR|dossier|référence|Ticketnummer|Order)\b/i.test(
        text
      ),
  };
}

/** The system prompt, built from what the document carries (rule 1). */
export function buildRailPrompt(fields: RailPromptFields): string {
  const legFields = [
    '- "from", "to": the departure and arrival station exactly as printed.',
    '- "departure", "arrival": "YYYY-MM-DDTHH:mm" on the station\'s local clock, as printed; "arrival" null when not printed.',
    ...(fields.train
      ? ['- "category", "number": the train as printed on this leg, e.g. "ICE" and "578".']
      : []),
    ...(fields.seat ? ['- "coach", "seat": as printed for this leg.'] : []),
  ];
  const bookingFields = [
    '- "class": 1 or 2 when the ticket states the class, else null.',
    ...(fields.reference ? ['- "reference": the booking or order number, copied verbatim.'] : []),
    ...(fields.price
      ? ['- "total", "currency": the labelled total amount and its ISO currency code.']
      : []),
  ];
  return [
    "You read train ticket confirmations (German, English, French, Italian).",
    'Answer with ONLY this JSON: {"legs":[LEG, ...], BOOKING FIELDS}.',
    "Copy every value verbatim from the document; a value that is not in the text is null.",
    "One LEG per train ride the document lists, in travel order.",
    "LEG fields:",
    ...legFields,
    "BOOKING FIELDS:",
    ...bookingFields,
  ].join("\n");
}

const nullableText = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" || /^(null|undefined|n\/a|none|-)$/i.test(s) ? null : s;
  });

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The model's answer, validated before a single field is trusted. */
export const railLlmAnswerSchema = z.object({
  legs: z
    .array(
      z.object({
        from: nullableText,
        to: nullableText,
        departure: nullableText,
        arrival: nullableText,
        category: nullableText,
        number: nullableText,
        coach: nullableText,
        seat: nullableText,
      })
    )
    .max(20)
    .default([]),
  class: nullableText,
  reference: nullableText,
  total: nullableText,
  currency: nullableText,
});

type LlmAnswer = z.infer<typeof railLlmAnswerSchema>;

/** Does `value` stand in the document? Case- and accent-insensitive. */
function printed(value: string | null, foldedText: string): value is string {
  return value !== null && foldedText.includes(foldStationName(value));
}

function checkedLeg(
  leg: LlmAnswer["legs"][number],
  folded: string,
  fields: RailPromptFields
): ParsedRailLeg | null {
  if (!printed(leg.from, folded) || !printed(leg.to, folded)) return null;
  if (!leg.departure || !LOCAL_TIME.test(leg.departure)) return null;
  const arrival = leg.arrival && LOCAL_TIME.test(leg.arrival) ? leg.arrival : null;
  // A train is kept only when that very token stands in the text.
  const token = fields.train
    ? trainTokenIn(`${leg.category ?? ""} ${leg.number ?? ""}`.trim())
    : null;
  const train =
    token && printed(`${token.category} ${token.number}`, folded)
      ? token
      : token && printed(`${token.category}${token.number}`, folded)
        ? token
        : null;
  return {
    depStationName: cleanStationName(leg.from),
    arrStationName: cleanStationName(leg.to),
    departureLocal: leg.departure,
    arrivalLocal: arrival,
    trainCategory: train?.category ?? null,
    trainNumber: train?.number ?? null,
    coach: fields.seat && printed(leg.coach, folded) ? leg.coach : null,
    seat: fields.seat && printed(leg.seat, folded) ? leg.seat : null,
    direction: null,
  };
}

/** The model's answer reduced to what the document proves (rule 2). */
export function bookingFromAnswer(
  answer: LlmAnswer,
  documentText: string,
  fields: RailPromptFields
): ParsedRailBooking | null {
  const folded = foldStationName(documentText);
  const legs = answer.legs
    .map((leg) => checkedLeg(leg, folded, fields))
    .filter((l): l is ParsedRailLeg => l !== null);
  if (legs.length === 0) return null;

  const total = fields.price && answer.total ? amountOf(answer.total) : null;
  const currency = answer.currency ? currencyOf(answer.currency) : null;
  const totalPrinted =
    total !== null &&
    (documentText.includes(answer.total ?? "") ||
      documentText.replace(/\s/g, "").includes(total.toFixed(2).replace(".", ",")) ||
      documentText.replace(/\s/g, "").includes(total.toFixed(2)));
  return {
    bookingReference:
      fields.reference && answer.reference && documentText.includes(answer.reference)
        ? answer.reference
        : null,
    travelClass: answer.class ? travelClassOf(`${answer.class}. Klasse`) : null,
    tariff: null,
    price: totalPrinted && currency ? total : null,
    currency: totalPrinted && currency ? currency : null,
    operator: null,
    legs,
    source: "ollama",
  };
}

export interface OllamaTarget {
  url: string;
  model: string;
}

/** Admin settings over env over the localhost default — the lodging precedence. */
export async function resolveOllamaTarget(): Promise<OllamaTarget> {
  let adminUrl: string | undefined;
  let adminModel: string | undefined;
  try {
    const admin = await getAdminParserSettings();
    adminUrl = admin?.ollamaUrl ?? undefined;
    adminModel = admin?.ollamaModel ?? undefined;
  } catch (err) {
    logger.warn({ err }, "[Rail Parser] Failed to load admin parser settings");
  }
  return {
    url: adminUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: adminModel ?? process.env.OLLAMA_MODEL ?? "gemma3:12b",
  };
}

export async function ollamaReachable(url: string): Promise<boolean> {
  try {
    const body = await requestTextWithDeadline({
      url: `${url}/api/tags`,
      method: "GET",
      timeoutMs: LLM_AVAILABILITY_TIMEOUT_MS,
      maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
      label: "Ollama availability check",
    });
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null && "models" in parsed;
  } catch {
    return false;
  }
}

/**
 * One generate request. Throws on transport or shape failures — the caller
 * turns each into its own reason; an answer with no provable leg is `null`.
 */
export async function parseRailWithOllama(
  text: string,
  target: OllamaTarget
): Promise<ParsedRailBooking | null> {
  const snippet = text.slice(0, LLM_TEXT_MAX_CHARS);
  if (text.length > LLM_TEXT_MAX_CHARS) {
    logger.warn(
      { totalChars: text.length, keptChars: LLM_TEXT_MAX_CHARS },
      "[Rail Parser] Document truncated before the model saw it"
    );
  }
  const fields = promptFieldsFor(snippet);
  const raw = await requestTextWithDeadline({
    url: `${target.url}/api/generate`,
    method: "POST",
    body: JSON.stringify({
      model: target.model,
      system: buildRailPrompt(fields),
      prompt: `Extract the train rides from this ticket.\n\nDOCUMENT:\n${snippet}`,
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0, num_ctx: 8192 },
    }),
    timeoutMs: llmParseTimeoutMs("RAIL_OLLAMA_TIMEOUT_MS"),
    maxResponseBytes: LLM_MAX_RESPONSE_BYTES,
    label: "Ollama request",
  });
  const envelope: unknown = JSON.parse(raw);
  const response =
    typeof envelope === "object" && envelope !== null
      ? (envelope as Record<string, unknown>).response
      : undefined;
  if (typeof response !== "string") throw new Error("Invalid Ollama response structure");
  const cleaned = response
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();
  const answer = railLlmAnswerSchema.safeParse(JSON.parse(cleaned));
  if (!answer.success) throw new Error("The model's answer did not match the rail schema");
  return bookingFromAnswer(answer.data, snippet, fields);
}
