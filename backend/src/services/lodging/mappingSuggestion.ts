import logger from "../../utils/logger";
import { llmRefusalFor } from "../llm/llmGate";
import { llmGenerateChain } from "../llm/llmProvider";

export const LODGING_CSV_FIELDS = [
  "name",
  "type",
  "chainName",
  "stars",
  "address",
  "city",
  "country",
  "lat",
  "lon",
  "googlePlaceId",
  "checkIn",
  "checkOut",
  "roomCategory",
  "board",
  "totalPrice",
  "currency",
  "ratingRoom",
  "ratingBreakfast",
  "ratingOverall",
  "bookingReference",
  "notes",
] as const;
export type LodgingCsvField = (typeof LODGING_CSV_FIELDS)[number];
export type LodgingCsvMapping = Partial<Record<LodgingCsvField, string>>;

export interface MappingSuggestionOptions {
  url?: string;
  model?: string;
}

// Deliberately short. This is an ADVISORY call — if the model is slow, the user
// gets the header heuristic instead of a spinner.
const DEFAULT_SUGGEST_TIMEOUT_MS = 20_000;

/**
 * Generate-request timeout, overridable via `LODGING_MAPPING_TIMEOUT_MS`
 * (test-only escape hatch — production always gets the 20s default). Read at
 * call time, not at module load, so tests can shrink it without needing to
 * re-import the module. Mirrors `getOllamaTimeoutMs` in
 * `lodgingBookingParser.ts`, but kept as its own env var: the two services
 * have independent timeout budgets (20s advisory vs. 120s full parse) and
 * must not be tunable through the same knob.
 */
function getSuggestTimeoutMs(): number {
  const raw = process.env.LODGING_MAPPING_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SUGGEST_TIMEOUT_MS;
}

const SYSTEM_PROMPT = `You map spreadsheet column headers to TravStats lodging fields.

Return ONLY JSON: {"mapping":{"<travstatsField>":"<csvHeader>", …}}.
Use ONLY these field names: ${LODGING_CSV_FIELDS.join(", ")}.
Every value MUST be one of the CSV headers given, copied VERBATIM.
Omit a field entirely if no header fits — NEVER invent a header, NEVER map two fields to the same header.

Hints: German headers are common. "Hotel"/"Name"/"Unterkunft" -> name. "Anreise"/"Check-in" -> checkIn. "Abreise" -> checkOut. "Bew. Zimmer"/"Bewertung Zimmer" -> ratingRoom. "Bew. Frühstück" -> ratingBreakfast. "Kette"/"Marke" -> chainName. "Straße"/"Adresse" -> address. "PLZ" belongs with address, not city. "Ort"/"Stadt" -> city. "Land" -> country. "Sterne" -> stars. "Preis"/"Gesamtpreis" -> totalPrice. "place_id"/"Google Place ID" -> googlePlaceId.`;

function isLodgingField(value: string): value is LodgingCsvField {
  return (LODGING_CSV_FIELDS as readonly string[]).includes(value);
}

/**
 * Parse a JSON string without ever surfacing the source text: V8's
 * `JSON.parse` SyntaxError embeds a snippet of the offending input in its
 * `message` (e.g. `Unexpected token 'h', "this is n"... is not valid
 * JSON`), which would leak the model's raw response into the logs if we
 * logged `err.message` directly. Callers get a stage-tagged log instead.
 */
const PARSE_FAILED = Symbol("lodging-mapping-parse-failed");

function safeJsonParse(text: string, stage: string): unknown | typeof PARSE_FAILED {
  try {
    return JSON.parse(text);
  } catch {
    logger.warn(
      {
        operation: "lodging_mapping_suggest_failed",
        stage,
        reason: "invalid_json",
      },
      "[Lodging Mapping] Ollama returned invalid JSON — degrading to empty mapping"
    );
    return PARSE_FAILED;
  }
}

/**
 * Keep only entries whose field name is one of ours AND whose value is one of
 * the headers actually present in the file. A hallucinated header would
 * drive the whole import off a cliff, so it is dropped rather than trusted.
 *
 * Every degrade path here is logged — but only as counts/reasons, never the
 * actual header or field names, since those are drawn from the user's CSV.
 */
function sanitize(raw: unknown, headers: string[]): LodgingCsvMapping {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    logger.warn(
      {
        operation: "lodging_mapping_suggest_failed",
        stage: "sanitize",
        reason: "not_an_object",
      },
      "[Lodging Mapping] Model response was not a JSON object — degrading to empty mapping"
    );
    return {};
  }
  const container = raw as Record<string, unknown>;
  const mappingRaw = container.mapping ?? container;
  if (typeof mappingRaw !== "object" || mappingRaw === null || Array.isArray(mappingRaw)) {
    logger.warn(
      {
        operation: "lodging_mapping_suggest_failed",
        stage: "sanitize",
        reason: "mapping_not_an_object",
      },
      "[Lodging Mapping] `mapping` was not a JSON object — degrading to empty mapping"
    );
    return {};
  }

  const headerSet = new Set(headers);
  const used = new Set<string>();
  const mapping: LodgingCsvMapping = {};
  let droppedUnknownHeader = 0;
  let droppedUnknownField = 0;
  let droppedDuplicate = 0;
  for (const [field, header] of Object.entries(mappingRaw as Record<string, unknown>)) {
    if (typeof header !== "string" || !headerSet.has(header)) {
      droppedUnknownHeader += 1;
      continue;
    }
    if (!isLodgingField(field)) {
      droppedUnknownField += 1;
      continue;
    }
    if (used.has(header)) {
      droppedDuplicate += 1;
      continue;
    }
    mapping[field] = header;
    used.add(header);
  }

  if (droppedUnknownHeader > 0 || droppedUnknownField > 0 || droppedDuplicate > 0) {
    logger.warn(
      {
        operation: "lodging_mapping_sanitize_dropped",
        droppedUnknownHeader,
        droppedUnknownField,
        droppedDuplicate,
        keptFields: Object.keys(mapping).length,
      },
      "[Lodging Mapping] Dropped one or more hallucinated/invalid pairs from the model's suggestion"
    );
  }
  return mapping;
}

/**
 * Ask the LLM for a column mapping. **The LLM is never in the critical
 * path.** The exact contract:
 *
 * - A HARD failure — unreachable, timed out, non-200 status, oversized
 *   response, unparsable JSON (at either the Ollama envelope or the model's
 *   own output), or JSON of the wrong shape (not an object, `mapping` not an
 *   object, a top-level array/string/null) — resolves to `{}`.
 * - A PARTIAL failure does NOT resolve to `{}`: if the model's mapping
 *   object mixes valid pairs with hallucinated ones (an unknown field name,
 *   a header not present in the uploaded file, or a header claimed by more
 *   than one field), `sanitize()` keeps only the individually-verified
 *   pairs and silently drops the rest. A non-empty return value is
 *   therefore never a guarantee that the model's full intent survived —
 *   callers must treat it as a partial, pre-filtered suggestion the user
 *   still reviews, not as ground truth.
 *
 * Every degrade path is logged (Pino `warn`) with counts/reasons only — CSV
 * content, the prompt, and the model's raw response are never logged.
 */
export async function suggestLodgingCsvMapping(
  headers: string[],
  sampleRows: Record<string, string>[],
  options?: MappingSuggestionOptions
): Promise<LodgingCsvMapping> {
  // Switched off by the admin: `{}` is the answer this function already gives
  // for "no suggestion", and the client's heuristic takes over from there.
  // A cloud provider without the admin's consent, or an incomplete one, is
  // the same "no suggestion" answer — and the rows never leave the instance.
  if (await llmRefusalFor()) return {};
  try {
    // `llmGenerateChain` tries Ollama first, then the enabled+consented cloud
    // slots in the admin's priority order — ONLY on a connectivity/protocol
    // failure (`http/boundedHttp.ts`'s deadline, a non-2xx, an unparsable
    // envelope). A slot that answers, however poor, stops the chain there.
    // Every attempt is logged; the catch below (which degrades to `{}`) only
    // fires once the WHOLE chain has failed.
    const { text } = await llmGenerateChain(
      {
        system: SYSTEM_PROMPT,
        prompt: `CSV headers: ${JSON.stringify(headers)}
Sample rows: ${JSON.stringify(sampleRows.slice(0, 3))}

Return the mapping JSON.`,
        temperature: 0,
        json: true,
        timeoutMs: getSuggestTimeoutMs(),
        label: "Mapping suggestion",
      },
      {
        ...(options?.url !== undefined ? { url: options.url } : {}),
        ...(options?.model !== undefined ? { model: options.model } : {}),
        withDefaults: true,
      }
    );

    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
      .trim();

    const modelMapping = safeJsonParse(cleaned, "mapping");
    if (modelMapping === PARSE_FAILED) return {};

    const mapping = sanitize(modelMapping, headers);
    logger.info(
      {
        operation: "lodging_mapping_suggested",
        fields: Object.keys(mapping).length,
      },
      "Lodging CSV mapping suggested"
    );
    return mapping;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[Lodging Mapping] Suggestion failed — the client falls back to its heuristic"
    );
    return {};
  }
}
