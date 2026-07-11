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
const SUGGEST_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You map spreadsheet column headers to TravStats lodging fields.

Return ONLY JSON: {"mapping":{"<travstatsField>":"<csvHeader>", …}}.
Use ONLY these field names: ${LODGING_CSV_FIELDS.join(", ")}.
Every value MUST be one of the CSV headers given, copied VERBATIM.
Omit a field entirely if no header fits — NEVER invent a header, NEVER map two fields to the same header.

Hints: German headers are common. "Hotel"/"Name"/"Unterkunft" -> name. "Anreise"/"Check-in" -> checkIn. "Abreise" -> checkOut. "Bew. Zimmer"/"Bewertung Zimmer" -> ratingRoom. "Bew. Frühstück" -> ratingBreakfast. "Kette"/"Marke" -> chainName. "Straße"/"Adresse" -> address. "PLZ" belongs with address, not city. "Ort"/"Stadt" -> city. "Land" -> country. "Sterne" -> stars. "Preis"/"Gesamtpreis" -> totalPrice. "place_id"/"Google Place ID" -> googlePlaceId.`;

function postJson(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search ?? ""),
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      },
    );
    req.setTimeout(SUGGEST_TIMEOUT_MS, () =>
      req.destroy(new Error(`Mapping suggestion timeout after ${SUGGEST_TIMEOUT_MS}ms`)),
    );
    req.on("error", reject);
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
      logger.warn({ err }, "[Lodging Mapping] Failed to load admin parser settings");
    }
  }
  return {
    url: options?.url ?? adminUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: options?.model ?? adminModel ?? process.env.OLLAMA_MODEL ?? "gemma3:12b",
  };
}

function isLodgingField(value: string): value is LodgingCsvField {
  return (LODGING_CSV_FIELDS as readonly string[]).includes(value);
}

/**
 * Keep only entries whose field name is one of ours AND whose value is one of
 * the headers actually present in the file. A hallucinated header would drive
 * the whole import off a cliff, so it is dropped rather than trusted.
 */
function sanitize(raw: unknown, headers: string[]): LodgingCsvMapping {
  if (typeof raw !== "object" || raw === null) return {};
  const container = raw as Record<string, unknown>;
  const mappingRaw = container.mapping ?? container;
  if (typeof mappingRaw !== "object" || mappingRaw === null) return {};

  const headerSet = new Set(headers);
  const used = new Set<string>();
  const mapping: LodgingCsvMapping = {};
  for (const [field, header] of Object.entries(mappingRaw as Record<string, unknown>)) {
    if (typeof header !== "string") continue;
    if (!isLodgingField(field)) continue;
    if (!headerSet.has(header)) continue;
    if (used.has(header)) continue;
    mapping[field] = header;
    used.add(header);
  }
  return mapping;
}

/**
 * Ask the LLM for a column mapping. **The LLM is never in the critical path**:
 * every failure — unreachable, slow, malformed, hallucinated — resolves to
 * `{}`, and the caller falls back to its header-name heuristic.
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
    const response: unknown = JSON.parse(raw);
    if (typeof response !== "object" || response === null || !("response" in response)) return {};
    const text = (response as Record<string, unknown>).response;
    if (typeof text !== "string") return {};

    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
      .trim();

    const mapping = sanitize(JSON.parse(cleaned) as unknown, headers);
    logger.info(
      { operation: "lodging_mapping_suggested", fields: Object.keys(mapping).length },
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
