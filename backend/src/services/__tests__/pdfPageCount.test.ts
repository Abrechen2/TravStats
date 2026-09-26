import { execFileSync } from "child_process";
import path from "path";

import { countPdfPages } from "../pdfPageCount";

/**
 * `countPdfPages` (forgejo#132 item 4) through the real PDF reader. pdf-parse
 * v2 needs pdfjs-dist's ESM worker, which Jest's CJS environment cannot load
 * (see pdfParser.test.ts) — inside Jest every count would come back null and a
 * test here would pass for the wrong reason. So the counting is run THROUGH
 * TSX, the loader the dev server uses, the way zoneOf.test.ts does it.
 */
const BACKEND_ROOT = path.resolve(__dirname, "../../..");

function countThroughTsx(): Record<string, number | null> {
  const script =
    'const { countPdfPages } = require("./src/services/pdfPageCount");' +
    'const { pdfWithPages } = require("./src/services/__tests__/fixtures/pdfWithPages");' +
    "(async () => {" +
    "  const out = {" +
    '    one: await countPdfPages(pdfWithPages(1, "one")),' +
    '    three: await countPdfPages(pdfWithPages(3, "three")),' +
    // No backslash in the script: Windows argument quoting mangles it.
    '    broken: await countPdfPages(Buffer.from("%PDF-1.4 broken %%EOF")),' +
    "  };" +
    "  process.stdout.write(JSON.stringify(out));" +
    "  process.exit(0);" +
    "})();";
  const out = execFileSync(
    process.execPath,
    [path.join(BACKEND_ROOT, "node_modules/tsx/dist/cli.mjs"), "-e", script],
    { cwd: BACKEND_ROOT, encoding: "utf8", env: { ...process.env, LOG_LEVEL: "silent" } }
  );
  return JSON.parse(out.trim().split("\n").pop() ?? "{}");
}

describe("countPdfPages", () => {
  it("counts a PDF's pages with the real reader, and answers null for an unreadable one", () => {
    expect(countThroughTsx()).toEqual({ one: 1, three: 3, broken: null });
  }, 60_000);

  it("answers null without opening bytes that are not a PDF", async () => {
    expect(await countPdfPages(Buffer.from("hello"))).toBeNull();
    expect(await countPdfPages(Buffer.alloc(0))).toBeNull();
  });
});
