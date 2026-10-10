import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Visible keyboard focus (forgejo#249). jsdom draws nothing and matches no
 * `:focus-visible`, so the guard reads the rule itself. The system ring alone
 * — accent at 18 % — measured 1.42:1 against `surface`, which is no visible
 * focus at all on a tablet; the accent outline is what carries it.
 */
const CSS = fs.readFileSync(path.resolve(__dirname, "..", "index.css"), "utf-8");

function rule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) return "";
  return CSS.slice(start, CSS.indexOf("}", start) + 1);
}

describe("the system focus style", () => {
  it("draws a solid accent outline under :focus-visible, not only the faint ring", () => {
    const block = rule(":focus-visible");
    expect(block).toMatch(/outline:\s*2px solid var\(--ts-accent\);/);
    expect(block).not.toMatch(/outline:\s*none/);
    expect(block).toMatch(/box-shadow:\s*var\(--ts-shadow-focus-ring\);/);
  });
});

/**
 * The system outline only helps where nothing removes it. Before this warden,
 * 25 field and control class strings carried `focus:outline-hidden` (or
 * `-none`) with a 1 px accent border as the only focus sign — the same
 * sub-3:1 indicator the system rule above was fixed for (forgejo#249).
 *
 * A class string may remove the outline only if the SAME string draws a
 * replacement of at least 2 px: a `ring-2`+ (on focus, focus-visible or
 * focus-within) or a `focus-visible:outline-*`. The one listed exception
 * draws its replacement on a wrapper, and says where.
 */
const REMOVES = /(^|[\s:])outline-(hidden|none)\b/;
const REPLACES =
  /(focus|focus-visible|focus-within):(ring-([2-9]|\[)|outline-(solid|dashed|[2-9]|\[|\())/;
const WRAPPER_DRAWS_FOCUS: Record<string, string> = {
  // The chip input is borderless inside its wrapper, which draws
  // `focus-within:ring-2` around the whole field.
  "components/TagInput.tsx": "focus-within:ring-2",
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (entry !== "__tests__") sourceFiles(full, acc);
    } else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("warden: no outline removal without a visible replacement", () => {
  const SRC = path.resolve(__dirname, "..");
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const name = path.relative(SRC, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf-8");
    // Class strings in TS(X); `@apply` lines and plain declarations in CSS.
    const chunks = file.endsWith(".css")
      ? source.split("\n").filter((line) => line.includes("@apply") || line.includes("outline-"))
      : (source.match(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g) ?? []);
    for (const chunk of chunks) {
      if (!REMOVES.test(chunk) || REPLACES.test(chunk)) continue;
      const wrapper = WRAPPER_DRAWS_FOCUS[name];
      if (wrapper && source.includes(wrapper)) continue;
      offenders.push(`${name}: ${chunk.trim().slice(0, 80)}`);
    }
  }

  it("removes no focus outline without drawing a 2 px+ replacement", () => {
    expect(offenders, "keyboard focus must stay visible at 3:1").toEqual([]);
  });

  it("recognises a removal and a replacement", () => {
    expect(REMOVES.test("border focus:outline-hidden")).toBe(true);
    expect(REPLACES.test("focus:outline-hidden focus:ring-2")).toBe(true);
    expect(REPLACES.test("focus:outline-hidden focus:ring-1")).toBe(false);
  });
});
