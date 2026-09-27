import fs from "fs";
import path from "path";

/**
 * Every place that asks a language model something must pass the admin switch
 * AND the cloud consent — and since beta.17 there is exactly one such place.
 *
 * The switch (`llmGate.ts`) is only as good as its coverage: a caller written
 * next year by someone who never heard of it would send documents to the
 * model with the switch off, and nothing would look different. So this scans
 * the source for the endpoints that make a model GENERATE — Ollama's
 * `/api/generate`, `/api/chat`, `/api/embed(dings)` and the OpenAI-compatible
 * `/chat/completions` — and requires:
 *
 *  1. that only the provider module names one (`llm/llmProvider.ts`). The six
 *     callers used to carry their own request each; a seventh that names an
 *     endpoint again is a parallel code path around the provider, and fails
 *     here by name;
 *  2. that the provider guards each endpoint it names (`assertMayAsk`, which
 *     runs `assertLlmEnabled()` and `assertLlmCloudConsent()`);
 *  3. that every known caller reaches the model through `llmGenerate`.
 *
 * `/api/tags` / `/models` (is the server up?) and `/api/pull` (admin downloads
 * a model) carry no document and stay allowed. So does `apiKeyTester.ts`,
 * listed below by name: it checks a user's OpenAI key with the fixed word
 * "test" and never sees a document.
 *
 * The scan is a floor, not a proof: it cannot see that the call sits in the
 * right function. `adminLlmSwitch.test.ts` and `llmProvider.test.ts` measure
 * the behaviour; this keeps a NEW caller from being missed.
 */

const SRC_ROOT = path.resolve(__dirname, "../../..");
const MODEL_ENDPOINT = /\/(?:api\/(?:generate|chat|embed(?:dings)?)|chat\/completions)\b/g;
const GUARD_CALL = /\bawait assertMayAsk\(target\)/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "generated") return [];
      return sourceFiles(full);
    }
    if (!entry.name.endsWith(".ts") || /\.(test|spec)\.ts$/.test(entry.name)) return [];
    return [full];
  });
}

/** Comments may name an endpoint (`llmTimeout.ts` explains a hung one). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const files = sourceFiles(SRC_ROOT).map((file) => ({
  file: path.relative(SRC_ROOT, file).replace(/\\/g, "/"),
  code: withoutComments(fs.readFileSync(file, "utf8")),
}));

/** Files that name a model endpoint but can never send a document — each with its reason. */
const NO_DOCUMENT_CALLERS = new Set([
  // Key check for the legacy per-user OpenAI key: sends the literal "test".
  "services/apiKeyTester.ts",
]);

const callers = files
  .filter(({ file }) => !NO_DOCUMENT_CALLERS.has(file))
  .map(({ file, code }) => ({
    file,
    endpoints: (code.match(MODEL_ENDPOINT) ?? []).length,
    guards: (code.match(GUARD_CALL) ?? []).length,
  }))
  .filter((entry) => entry.endpoints > 0);

/** The callers that ask a model — each must do it through the provider. */
const MODEL_CALLERS = [
  "services/parsers/text/ollamaTextParser.ts",
  "services/cruiseBookingParser.ts",
  "services/lodging/lodgingBookingParser.ts",
  "services/lodging/mappingSuggestion.ts",
  "services/tripSummaryService.ts",
  "services/rail/parser/railLlmParser.ts",
];

describe("every language-model request passes the admin switch and the cloud consent", () => {
  it("finds the model endpoints only in the provider module — no parallel code path", () => {
    expect(callers.map((c) => c.file)).toEqual(["services/llm/llmProvider.ts"]);
  });

  it("names both protocols' generate endpoints there — the scan is not vacuous", () => {
    expect(callers[0]?.endpoints).toBe(2);
  });

  it.each(callers.map((c) => [c.file, c] as const))(
    "%s guards each model endpoint it names",
    (_file, caller) => {
      expect(caller.guards).toBeGreaterThanOrEqual(caller.endpoints);
    }
  );

  it.each(MODEL_CALLERS)("%s asks the model through llmGenerate", (file) => {
    const source = files.find((f) => f.file === file);
    expect(source?.code).toMatch(/\bllmGenerate\(/);
  });
});
