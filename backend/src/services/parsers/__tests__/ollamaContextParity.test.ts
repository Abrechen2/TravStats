import fs from "fs";
import path from "path";

/**
 * Every model request asks Ollama for the same context window — by having
 * only ONE place that can say it.
 *
 * Ollama keys its loaded model on the options it was loaded with: a request
 * with a different `num_ctx` unloads the model and reloads it, which on the
 * owner's Mac mini took longer than the 240 s the hotel parser waited — which
 * is why a hotel confirmation timed out while the flight parser was warm
 * (fixed in fc565deb). Until beta.17 this test read three parser files and
 * demanded one number, while the CSV mapping suggestion (4096) and the trip
 * summary were left out "on purpose" — and forced the same reload. Now the
 * provider module (`llm/llmProvider.ts`) is the only file that sends
 * `num_ctx`, from one constant, for every caller and every provider.
 */
const SRC_ROOT = path.resolve(__dirname, "../../..");

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

const withNumCtx = sourceFiles(SRC_ROOT)
  .map((file) => ({
    file: path.relative(SRC_ROOT, file).replace(/\\/g, "/"),
    hits: [...fs.readFileSync(file, "utf8").matchAll(/num_ctx:\s*([A-Za-z_0-9]+)/g)].map(
      (m) => m[1]
    ),
  }))
  .filter((entry) => entry.hits.length > 0);

describe("one Ollama context window for every model request", () => {
  it("sets num_ctx in exactly one place, from the shared constant", () => {
    expect(withNumCtx).toEqual([{ file: "services/llm/llmProvider.ts", hits: ["LLM_NUM_CTX"] }]);
  });
});
