import { readFileSync } from "fs";
import { join } from "path";

/**
 * The three document parsers must ask Ollama for the same context window.
 *
 * Ollama keys its loaded model on the options it was loaded with: a request
 * with a different `num_ctx` unloads the model and reloads it, which on the
 * owner's Mac mini took longer than the 240 s the hotel parser waits — which
 * is why a hotel confirmation timed out while the flight parser was warm
 * (fixed in fc565deb; ollamaTextParser.ts says so in a comment). A comment
 * holds only while someone remembers it. This reads the three files and
 * demands one number.
 *
 * mappingSuggestion.ts (4096) and tripSummaryService.ts are different
 * workloads that run at different times and are left out on purpose.
 */
const PARSERS = [
  "services/parsers/text/ollamaTextParser.ts",
  "services/lodging/lodgingBookingParser.ts",
  "services/cruiseBookingParser.ts",
];

function numCtxOf(relative: string): number[] {
  const source = readFileSync(join(__dirname, "..", "..", "..", relative), "utf8");
  return [...source.matchAll(/num_ctx:\s*(\d+)/g)].map((m) => Number(m[1]));
}

describe("Ollama num_ctx parity across the three document parsers", () => {
  it("finds a num_ctx in every parser — the scan must not silently match nothing", () => {
    for (const parser of PARSERS) {
      expect({ parser, hits: numCtxOf(parser).length }).toEqual({ parser, hits: 1 });
    }
  });

  it("asks for the same context window in all three", () => {
    const values = new Set(PARSERS.flatMap(numCtxOf));
    expect([...values]).toHaveLength(1);
  });
});
