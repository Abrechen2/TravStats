import fs from "fs";
import path from "path";

/**
 * Every place that asks a language model something must pass the admin switch.
 *
 * The switch (`llmGate.ts`) is only as good as its coverage: a sixth caller
 * written next year by someone who never heard of it would send documents to
 * the model with the switch off, and nothing would look different. So this
 * scans the source for the endpoints that make a model GENERATE — Ollama's
 * `/api/generate`, `/api/chat`, `/api/embed(dings)` — and requires every file
 * that names one to call `assertLlmEnabled()` at least as often as it names
 * them. `/api/tags` (is the server up?) and `/api/pull` (admin downloads a
 * model) are not model calls and stay allowed.
 *
 * The scan is a floor, not a proof: it cannot see that the call sits in the
 * right function. `adminLlmSwitch.test.ts` measures the behaviour; this keeps
 * a NEW caller from being missed.
 */

const SRC_ROOT = path.resolve(__dirname, "../../..");
const MODEL_ENDPOINT = /\/api\/(?:generate|chat|embed(?:dings)?)\b/g;
const GUARD_CALL = /\bassertLlmEnabled\(\)/g;

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

const callers = sourceFiles(SRC_ROOT)
  .map((file) => {
    const code = withoutComments(fs.readFileSync(file, "utf8"));
    return {
      file: path.relative(SRC_ROOT, file).replace(/\\/g, "/"),
      endpoints: (code.match(MODEL_ENDPOINT) ?? []).length,
      guards: (code.match(GUARD_CALL) ?? []).length,
    };
  })
  .filter((entry) => entry.endpoints > 0);

describe("every language-model caller passes the admin switch", () => {
  it("finds the model callers this was written against — the scan is not vacuous", () => {
    const files = callers.map((c) => c.file);
    expect(files).toEqual(
      expect.arrayContaining([
        "services/parsers/text/ollamaTextParser.ts",
        "services/cruiseBookingParser.ts",
        "services/lodging/lodgingBookingParser.ts",
        "services/lodging/mappingSuggestion.ts",
        "services/tripSummaryService.ts",
      ])
    );
  });

  it.each(callers.map((c) => [c.file, c] as const))(
    "%s calls assertLlmEnabled() in front of each model endpoint",
    (_file, caller) => {
      expect(caller.guards).toBeGreaterThanOrEqual(caller.endpoints);
    }
  );
});
