import http from "http";
import https from "https";
import logger from "../../utils/logger";
import { getAdminParserSettings } from "../parserSettings";

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

// The response is always a small JSON mapping object — cap it generously so a
// misbehaving endpoint can never make us buffer an unbounded stream in memory.
const MAX_RESPONSE_BYTES = 2_000_000;

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
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SUGGEST_TIMEOUT_MS;
}

const SYSTEM_PROMPT = `You map spreadsheet column headers to TravStats lodging fields.

Return ONLY JSON: {"mapping":{"<travstatsField>":"<csvHeader>", …}}.
Use ONLY these field names: ${LODGING_CSV_FIELDS.join(", ")}.
Every value MUST be one of the CSV headers given, copied VERBATIM.
Omit a field entirely if no header fits — NEVER invent a header, NEVER map two fields to the same header.

Hints: German headers are common. "Hotel"/"Name"/"Unterkunft" -> name. "Anreise"/"Check-in" -> checkIn. "Abreise" -> checkOut. "Bew. Zimmer"/"Bewertung Zimmer" -> ratingRoom. "Bew. Frühstück" -> ratingBreakfast. "Kette"/"Marke" -> chainName. "Straße"/"Adresse" -> address. "PLZ" belongs with address, not city. "Ort"/"Stadt" -> city. "Land" -> country. "Sterne" -> stars. "Preis"/"Gesamtpreis" -> totalPrice. "place_id"/"Google Place ID" -> googlePlaceId.`;

/**
 * POST the request with a HARD deadline: `timeoutMs` after the request
 * starts, the connection is torn down unconditionally. This is deliberately
 * NOT `req.setTimeout()` — that API resets on every byte of socket activity,
 * so a server trickling bytes could stall past the budget indefinitely,
 * which is exactly what "never in the critical path" forbids. The response
 * body is also capped at `MAX_RESPONSE_BYTES` and the status code is
 * checked explicitly — neither is left to downstream JSON-shape checks to
 * catch by coincidence.
 */
function postJson(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const timeoutMs = getSuggestTimeoutMs();
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      fn();
    };

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        let receivedBytes = 0;
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            settle(() =>
              reject(
                new Error(
                  `Mapping suggestion response exceeded ${MAX_RESPONSE_BYTES} bytes`,
                ),
              ),
            );
            req.destroy();
            return;
          }
          data += chunk;
        });
        res.on("end", () => {
          if (settled) return;
          const statusCode = res.statusCode ?? 0;
          if (statusCode !== 200) {
            settle(() =>
              reject(new Error(`Ollama returned HTTP ${statusCode}`)),
            );
            return;
          }
          settle(() => resolve(data));
        });
      },
    );

    deadline = setTimeout(() => {
      settle(() =>
        reject(new Error(`Mapping suggestion timeout after ${timeoutMs}ms`)),
      );
      req.destroy();
    }, timeoutMs);

    req.on("error", (err) => {
      settle(() => reject(err));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Merge explicit options over admin_settings over env over the localhost
 * default — the exact precedence `parseLodgingBookingText` in
 * `lodgingBookingParser.ts` uses. A correctly configured remote Ollama must
 * never be bypassed in favour of localhost, and a fully-specified caller
 * (tests) must never be overridden by whatever is in the database.
 */
async function resolveOptions(
  options?: MappingSuggestionOptions,
): Promise<Required<MappingSuggestionOptions>> {
  let adminUrl: string | undefined;
  let adminModel: string | undefined;
  if (!options?.url || !options?.model) {
    try {
      const admin = await getAdminParserSettings();
      adminUrl = admin?.ollamaUrl ?? undefined;
      adminModel = admin?.ollamaModel ?? undefined;
    } catch (err) {
      logger.warn(
        { err },
        "[Lodging Mapping] Failed to load admin parser settings",
      );
    }
  }
  return {
    url:
      options?.url ??
      adminUrl ??
      process.env.OLLAMA_URL ??
      "http://localhost:11434",
    model:
      options?.model ?? adminModel ?? process.env.OLLAMA_MODEL ?? "gemma3:12b",
  };
}

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

function safeJsonParse(
  text: string,
  stage: string,
): unknown | typeof PARSE_FAILED {
  try {
    return JSON.parse(text);
  } catch {
    logger.warn(
      {
        operation: "lodging_mapping_suggest_failed",
        stage,
        reason: "invalid_json",
      },
      "[Lodging Mapping] Ollama returned invalid JSON — degrading to empty mapping",
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
      "[Lodging Mapping] Model response was not a JSON object — degrading to empty mapping",
    );
    return {};
  }
  const container = raw as Record<string, unknown>;
  const mappingRaw = container.mapping ?? container;
  if (
    typeof mappingRaw !== "object" ||
    mappingRaw === null ||
    Array.isArray(mappingRaw)
  ) {
    logger.warn(
      {
        operation: "lodging_mapping_suggest_failed",
        stage: "sanitize",
        reason: "mapping_not_an_object",
      },
      "[Lodging Mapping] `mapping` was not a JSON object — degrading to empty mapping",
    );
    return {};
  }

  const headerSet = new Set(headers);
  const used = new Set<string>();
  const mapping: LodgingCsvMapping = {};
  let droppedUnknownHeader = 0;
  let droppedUnknownField = 0;
  let droppedDuplicate = 0;
  for (const [field, header] of Object.entries(
    mappingRaw as Record<string, unknown>,
  )) {
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

  if (
    droppedUnknownHeader > 0 ||
    droppedUnknownField > 0 ||
    droppedDuplicate > 0
  ) {
    logger.warn(
      {
        operation: "lodging_mapping_sanitize_dropped",
        droppedUnknownHeader,
        droppedUnknownField,
        droppedDuplicate,
        keptFields: Object.keys(mapping).length,
      },
      "[Lodging Mapping] Dropped one or more hallucinated/invalid pairs from the model's suggestion",
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
  options?: MappingSuggestionOptions,
): Promise<LodgingCsvMapping> {
  try {
    const { url, model } = await resolveOptions(options);
    const body = JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      prompt: `CSV headers: ${JSON.stringify(headers)}\nSample rows: ${JSON.stringify(
        sampleRows.slice(0, 3),
      )}\n\nReturn the mapping JSON.`,
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0, num_ctx: 4096 },
    });

    const raw = await postJson(`${url}/api/generate`, body);

    const envelope = safeJsonParse(raw, "envelope");
    if (envelope === PARSE_FAILED) return {};
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      !("response" in envelope)
    ) {
      logger.warn(
        {
          operation: "lodging_mapping_suggest_failed",
          stage: "envelope",
          reason: "unexpected_shape",
        },
        "[Lodging Mapping] Ollama response envelope had an unexpected shape — degrading to empty mapping",
      );
      return {};
    }
    const text = (envelope as Record<string, unknown>).response;
    if (typeof text !== "string") {
      logger.warn(
        {
          operation: "lodging_mapping_suggest_failed",
          stage: "envelope",
          reason: "response_not_string",
        },
        "[Lodging Mapping] Ollama response.response was not a string — degrading to empty mapping",
      );
      return {};
    }

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
      "Lodging CSV mapping suggested",
    );
    return mapping;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[Lodging Mapping] Suggestion failed — the client falls back to its heuristic",
    );
    return {};
  }
}
