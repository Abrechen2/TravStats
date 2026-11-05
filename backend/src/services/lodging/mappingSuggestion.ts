import { RATING_CATEGORIES } from "../../shared/ratingCategories";
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
  "ratingService",
  "ratingOverall",
  "bookingReference",
  "notes",
] as const;
export type LodgingCsvField = (typeof LODGING_CSV_FIELDS)[number];
/**
 * A mapping key is a fixed field, or `rating:<category key>` for a rating
 * category that has no column of its own (built-in `bed` ... `quiet`, own
 * `custom:<id>`). The three legacy categories keep their fixed fields.
 */
export type LodgingCsvMapping = Partial<Record<LodgingCsvField | `rating:${string}`, string>>;

export const RATING_FIELD_PREFIX = "rating:";

/** An own category as the suggestion needs it: the `custom:<id>` key and its live name. */
export interface OwnCategoryRef {
  key: string;
  name: string;
}

/** A rating column the model named a category for that this account does not have. */
export interface UnmappedRatingColumn {
  name: string;
  header: string;
}

export interface MappingSuggestion {
  mapping: LodgingCsvMapping;
  unmappedRatings: UnmappedRatingColumn[];
}

const LEGACY_RATING_FIELD: Record<string, LodgingCsvField> = {
  room: "ratingRoom",
  breakfast: "ratingBreakfast",
  service: "ratingService",
};

/**
 * Which mapping field a category NAME stands for: a built-in key, or one of
 * the account's own categories by name, both case-insensitive. null for a name
 * the account does not have - the caller reports it, it never creates it.
 */
export function ratingFieldForName(
  name: string,
  own: readonly OwnCategoryRef[]
): LodgingCsvField | `rating:${string}` | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const builtIn = RATING_CATEGORIES.find((k) => k === wanted);
  if (builtIn) return LEGACY_RATING_FIELD[builtIn] ?? `${RATING_FIELD_PREFIX}${builtIn}`;
  const hit = own.find((c) => c.name.trim().toLowerCase() === wanted);
  return hit ? `${RATING_FIELD_PREFIX}${hit.key}` : null;
}

export interface MappingSuggestionOptions {
  /** The account whose CSV this is — a cloud model needs its consent (forgejo#392). */
  userId?: string;
  url?: string;
  model?: string;
  /** The account's live own rating categories, so the model can name them. */
  ownCategories?: readonly OwnCategoryRef[];
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

A rating column of a further category is returned as "rating:<category name>": "<csvHeader>", using a category name from the list given in the request (a built-in key such as bed, bathroom, cleanliness, location, parking, wifi, quiet, or one of the account's own names). Keep ratingRoom, ratingBreakfast and ratingService for room, breakfast and service.

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
function sanitize(
  raw: unknown,
  headers: string[],
  own: readonly OwnCategoryRef[]
): MappingSuggestion {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    logger.warn(
      {
        operation: "lodging_mapping_suggest_failed",
        stage: "sanitize",
        reason: "not_an_object",
      },
      "[Lodging Mapping] Model response was not a JSON object — degrading to empty mapping"
    );
    return { mapping: {}, unmappedRatings: [] };
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
    return { mapping: {}, unmappedRatings: [] };
  }

  const headerSet = new Set(headers);
  const used = new Set<string>();
  const mapping: LodgingCsvMapping = {};
  const unmappedRatings: UnmappedRatingColumn[] = [];
  let droppedUnknownHeader = 0;
  let droppedUnknownField = 0;
  let droppedDuplicate = 0;
  for (const [field, header] of Object.entries(mappingRaw as Record<string, unknown>)) {
    if (typeof header !== "string" || !headerSet.has(header)) {
      droppedUnknownHeader += 1;
      continue;
    }
    let target: LodgingCsvField | `rating:${string}` | null = null;
    if (field.startsWith(RATING_FIELD_PREFIX)) {
      const categoryName = field.slice(RATING_FIELD_PREFIX.length);
      target = ratingFieldForName(categoryName, own);
      if (target === null) {
        // A category this account does not have: reported, never created.
        if (!used.has(header)) {
          unmappedRatings.push({ name: categoryName, header });
          used.add(header);
        }
        continue;
      }
    } else if (isLodgingField(field)) {
      target = field;
    }
    if (target === null) {
      droppedUnknownField += 1;
      continue;
    }
    if (used.has(header) || mapping[target] !== undefined) {
      droppedDuplicate += 1;
      continue;
    }
    mapping[target] = header;
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
  return { mapping, unmappedRatings };
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
export async function suggestLodgingCsvMappingDetailed(
  headers: string[],
  sampleRows: Record<string, string>[],
  options?: MappingSuggestionOptions
): Promise<MappingSuggestion> {
  // Switched off by the admin: `{}` is the answer this function already gives
  // for "no suggestion", and the client's heuristic takes over from there.
  // A cloud provider without the admin's consent, or an incomplete one, is
  // the same "no suggestion" answer — and the rows never leave the instance.
  if (await llmRefusalFor(options?.userId)) return NO_SUGGESTION;
  try {
    // `llmGenerateChain` tries Ollama first, then the enabled+consented cloud
    // slots in the admin's priority order — ONLY on a connectivity/protocol
    // failure (`http/boundedHttp.ts`'s deadline, a non-2xx, an unparsable
    // envelope). A slot that answers, however poor, stops the chain there.
    // Every attempt is logged; the catch below (which degrades to `{}`) only
    // fires once the WHOLE chain has failed.
    const { text } = await llmGenerateChain(
      {
        ...(options?.userId !== undefined ? { userId: options.userId } : {}),
        system: SYSTEM_PROMPT,
        prompt: `CSV headers: ${JSON.stringify(headers)}
Sample rows: ${JSON.stringify(sampleRows.slice(0, 3))}
Rating category names for "rating:<name>": ${JSON.stringify([
          ...RATING_CATEGORIES.filter((k) => !(k in LEGACY_RATING_FIELD)),
          ...(options?.ownCategories ?? []).map((c) => c.name),
        ])}

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
    if (modelMapping === PARSE_FAILED) return NO_SUGGESTION;

    const { mapping, unmappedRatings } = sanitize(
      modelMapping,
      headers,
      options?.ownCategories ?? []
    );
    logger.info(
      {
        operation: "lodging_mapping_suggested",
        fields: Object.keys(mapping).length,
      },
      "Lodging CSV mapping suggested"
    );
    return { mapping, unmappedRatings };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[Lodging Mapping] Suggestion failed — the client falls back to its heuristic"
    );
    return NO_SUGGESTION;
  }
}

const NO_SUGGESTION: MappingSuggestion = { mapping: {}, unmappedRatings: [] };

/** The mapping alone - what callers that do not report unmapped ratings use. */
export async function suggestLodgingCsvMapping(
  headers: string[],
  sampleRows: Record<string, string>[],
  options?: MappingSuggestionOptions
): Promise<LodgingCsvMapping> {
  return (await suggestLodgingCsvMappingDetailed(headers, sampleRows, options)).mapping;
}
