import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import baseline from "./helpReachability.baseline.json";

/**
 * Help a finger, a keyboard and a screen reader can reach (forgejo#249).
 *
 * Measured before this existed: 60-odd explanations across all eight domains
 * lived in a `title` on a span, a badge or a dash — "why is this a dash", "what
 * does this tier mean", "why did the upload fail". A `title` appears only
 * under a hovering mouse: never on the iPads the web build is drawn for, never
 * to the keyboard, and to screen readers only sometimes. The fix is one
 * primitive, `ui/Toggletip` (and `HelpIcon`, its "?" form); this warden keeps
 * the fix from eroding one new `title` at a time.
 *
 * It is a RATCHET in the repo's usual shape. A `title` on an element that is
 * not itself a control fails, unless its file is listed in the baseline with
 * the number of such titles and WHY they are not help. The list fails on a
 * new title AND on a stale count, so it only shrinks. The accepted reasons are
 * deliberately few — each names something that is not an explanation:
 *
 * - `truncation`: the full text of a cell an ellipsis cut short;
 * - `chart-value`: the exact figure behind a bar, a cell or a segment;
 * - `expansion`: the long form of a code or logo shown in its place;
 * - `control-name`: the name of a pointer-only control that also carries it
 *   as `aria-label`.
 *
 * Anything that says WHY, or what something MEANS, is help and belongs in a
 * `Toggletip`. To fix an entry: move it to `Toggletip`/`HelpIcon` (or drop a
 * title that only repeats the visible text), then lower or remove its count.
 */

const SRC = resolve(__dirname, "..");
const rel = (file: string): string => relative(SRC, file).split(sep).join("/");

const REASONS = new Set(["truncation", "chart-value", "expansion", "control-name"]);

/** Elements a `title` may sit on: the control itself is focusable and named. */
const CONTROL_TAGS = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
  "option",
  "iframe",
]);
const CONTROL_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "switch",
  "radio",
  "tab",
  "menuitem",
  "option",
  "slider",
]);

function sourceFiles(dir = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "generated") continue;
      sourceFiles(full, acc);
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) acc.push(full);
  }
  return acc;
}

interface Finding {
  titles: number;
  tooltips: number;
}

function attrValue(attr: ts.JsxAttribute, sf: ts.SourceFile): string | null {
  const init = attr.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    return ts.isStringLiteral(init.expression) ? init.expression.text : init.expression.getText(sf);
  }
  return init.getText(sf);
}

/** Scans one file's JSX. */
function scanSource(source: string, fileName = "x.tsx"): Finding {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const finding: Finding = { titles: 0, tooltips: 0 };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const byName = new Map(attrs.map((a) => [a.name.getText(sf), a]));
      const role = byName.get("role");
      const roleValue = role ? attrValue(role, sf) : null;
      // Also a conditional role (`pinned ? "dialog" : "tooltip"`).
      if (roleValue === "tooltip" || /["']tooltip["']/.test(roleValue ?? "")) {
        finding.tooltips += 1;
      }

      // Only intrinsic elements: a capitalised component's `title` is a prop
      // (a dialog heading, a card title), not the HTML attribute.
      const intrinsic = /^[a-z]/.test(tag);
      const isControl =
        CONTROL_TAGS.has(tag) || (roleValue !== null && CONTROL_ROLES.has(roleValue));
      if (intrinsic && !isControl && byName.has("title")) {
        const title = byName.get("title") as ts.JsxAttribute;
        if (attrValue(title, sf) !== "undefined") finding.titles += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return finding;
}

const frozen = baseline.titleOnly as Record<string, { count: number; why: string }>;

describe("warden: help is not hidden in a hover title", () => {
  const scanned = sourceFiles().map((file) => ({
    name: rel(file),
    ...scanSource(readFileSync(file, "utf8"), file),
  }));
  const titled = Object.fromEntries(
    scanned.filter((f) => f.titles > 0).map((f) => [f.name, f.titles])
  );

  it("finds files to judge — otherwise the scan has drifted and passes silently", () => {
    expect(scanned.length).toBeGreaterThan(500);
    expect(Object.keys(titled).length).toBeGreaterThan(0);
  });

  it("gains no new title on a non-control — use ui/Toggletip or HelpIcon", () => {
    const added = Object.entries(titled)
      .filter(([name, count]) => count > (frozen[name]?.count ?? 0))
      .map(([name, count]) => `${name}: ${count} (baseline ${frozen[name]?.count ?? 0})`);
    expect(added, "a hover title is unreachable by touch and keyboard").toEqual([]);
  });

  it("keeps the baseline honest — a fixed file leaves the list", () => {
    const stale = Object.entries(frozen)
      .filter(([name, entry]) => (titled[name] ?? 0) < entry.count)
      .map(([name, entry]) => `${name}: ${titled[name] ?? 0} (baseline ${entry.count})`);
    expect(stale, "lower or remove these baseline entries").toEqual([]);
  });

  it("names a reason that is not help for every baseline entry", () => {
    const unexplained = Object.entries(frozen)
      .filter(([, entry]) => !REASONS.has(entry.why))
      .map(([name]) => name);
    expect(unexplained).toEqual([]);
  });

  it("draws role=tooltip only inside the shared Toggletip", () => {
    const elsewhere = scanned
      .filter((f) => f.tooltips > 0 && f.name !== "components/ui/Toggletip.tsx")
      .map((f) => f.name);
    expect(elsewhere, "a hand-rolled tooltip — use ui/Toggletip").toEqual([]);
  });
});

describe("the scan itself", () => {
  it("counts a title on a span and ignores one on a button or a component prop", () => {
    const found = scanSource(`
      const a = <span title={t("why")}>—</span>;
      const b = <button title="Close">x</button>;
      const c = <Modal title="Heading" />;
      const d = <div role="link" title="x" />;
      const e = <span title={undefined} />;
    `);
    expect(found.titles).toBe(1);
  });

  it("counts a hand-rolled tooltip", () => {
    expect(scanSource(`const a = <span role="tooltip">x</span>;`).tooltips).toBe(1);
  });
});
