import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import baseline from "./statsCountingHelp.baseline.json";
import { COUNTING_FIELDS } from "../components/Stats/counting/countingEntry";

/**
 * Every statistics figure explains itself and opens its entries
 * (forgejo#256–#265).
 *
 * The acceptance criterion of every statistics issue is the same two halves:
 * the figure states its counting unit, time rule, source, coverage and
 * exclusions — ONE component, `Stats/counting/CountingHelp` — and a tap on the
 * number opens the entries behind it (the evidence panel). This warden holds
 * both, per section, as a RATCHET in the repo's usual shape:
 *
 * - A **section** is a component under `components/Stats/` that renders a
 *   figure (see `FIGURE_TAGS`), minus the figure primitives themselves. A
 *   figure drawn WITHOUT a primitive — a ranking row that is a link to the
 *   entity's own page, say — declares itself with a `data-stat-figure`
 *   attribute, or the scan cannot see the section at all (forgejo#256: the
 *   aircraft ranking was invisible to it).
 * - **Counting help** is rendered when the section draws `CountingHelp`, or a
 *   primitive that draws it for each figure (`HELP_TAGS`).
 * - A **figure without an evidence jump** is a `StatCard` or `InsightTile`
 *   that carries no `evidence` prop. A tile fed through a spread (`{...vm}`)
 *   cannot be judged statically and is not counted.
 * - A data-driven grid counts too: every object of an array declared with one
 *   of `FIGURE_ARRAY_TYPES` (the cruise tab's `Kpi[]`, drawn by its
 *   `KpiGrid`) is a figure, and one without an `evidence` property is a
 *   figure without a jump. Only types whose every array can be held at zero
 *   are listed — a new type joins with its sections fixed, not frozen.
 *
 * `statsCountingHelp.baseline.json` freezes today's gaps, one entry per
 * section, holding ONLY its gaps: `"missingCountingHelp": true` and/or
 * `"figuresWithoutEvidence": <n>`. A section with no gap is not listed. The
 * check fails on a new gap AND on a stale entry, so the list only shrinks: fix
 * a section, then lower or delete its entry.
 */

const SRC = resolve(__dirname, "..");
const STATS = join(SRC, "components", "Stats");
const LOCALES = join(SRC, "i18n", "resources");
const rel = (file: string): string => relative(SRC, file).split(sep).join("/");

/** Elements that put a figure on screen. */
const FIGURE_TAGS = new Set([
  "StatCard",
  "InsightTile",
  "DualFigureCard",
  "ScorecardTile",
  "EvidenceNumber",
  "EvidenceCount",
  "EvidenceTrigger",
]);
/** Marks a figure drawn without a figure primitive (a link row to the entity's page). */
const FIGURE_ATTRIBUTE = "data-stat-figure";
/** Tiles whose `evidence` prop is the jump to the entries; without it the number opens nothing. */
const EVIDENCE_TILES = new Set(["StatCard", "InsightTile"]);
/** Array element types of data-driven figure grids: each object literal is one figure. */
const FIGURE_ARRAY_TYPES = new Set(["Kpi"]);
/** Elements that render the counting help (the last two draw `CountingHelp` themselves). */
const HELP_TAGS = new Set(["CountingHelp", "InsightTile", "InsightHeading"]);
/** The figure primitives — they are what sections are built from, not sections. */
const PRIMITIVES = new Set([
  "components/Stats/StatCard.tsx",
  "components/Stats/DualFigureCard.tsx",
  "components/Stats/EvidenceNumber.tsx",
  "components/Stats/EvidenceTrigger.tsx",
  "components/Stats/insights/EvidenceCount.tsx",
  "components/Stats/insights/InsightHeading.tsx",
  "components/Stats/insight/InsightTile.tsx",
  "components/Stats/scorecard/ScorecardTile.tsx",
  "components/Stats/counting/CountingHelp.tsx",
]);

interface Scan {
  figures: number;
  hasCountingHelp: boolean;
  figuresWithoutEvidence: number;
}

export function scanSection(source: string, fileName = "x.tsx"): Scan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const scan: Scan = { figures: 0, hasCountingHelp: false, figuresWithoutEvidence: 0 };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      ts.isArrayTypeNode(node.type) &&
      FIGURE_ARRAY_TYPES.has(node.type.elementType.getText(sf)) &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        scan.figures += 1;
        const evidence = element.properties.some(
          (p) => p.name !== undefined && p.name.getText(sf) === "evidence"
        );
        if (!evidence) scan.figuresWithoutEvidence += 1;
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const declared = node.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === FIGURE_ATTRIBUTE
      );
      if (FIGURE_TAGS.has(tag) || declared) scan.figures += 1;
      if (HELP_TAGS.has(tag)) scan.hasCountingHelp = true;
      if (EVIDENCE_TILES.has(tag)) {
        const props = node.attributes.properties;
        const spread = props.some(ts.isJsxSpreadAttribute);
        const evidence = props.some(
          (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "evidence"
        );
        if (!spread && !evidence) scan.figuresWithoutEvidence += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return scan;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__") sourceFiles(full, acc);
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

interface Gaps {
  missingCountingHelp?: boolean;
  figuresWithoutEvidence?: number;
}

const frozen = baseline.sections as Record<string, Gaps>;

const sections = new Map<string, { source: string; scan: Scan }>();
for (const file of sourceFiles(STATS)) {
  const name = rel(file);
  if (PRIMITIVES.has(name)) continue;
  const source = readFileSync(file, "utf8");
  const scan = scanSection(source, file);
  if (scan.figures > 0) sections.set(name, { source, scan });
}

describe("warden: every statistics section explains its figures and opens their entries", () => {
  it("finds sections to judge — otherwise the scan has drifted and passes silently", () => {
    expect(sections.size).toBeGreaterThan(40);
  });

  it("adds no section without counting help", () => {
    const missing = [...sections]
      .filter(([name, { scan }]) => !scan.hasCountingHelp && !frozen[name]?.missingCountingHelp)
      .map(
        ([name]) =>
          `${name}: renders figures but no "So wird gezählt" — add <CountingHelp> ` +
          `(components/Stats/counting/CountingHelp.tsx) with an entry per figure`
      );
    expect(missing).toEqual([]);
  });

  it("adds no figure without an evidence jump", () => {
    const grown = [...sections]
      .filter(
        ([name, { scan }]) =>
          scan.figuresWithoutEvidence > (frozen[name]?.figuresWithoutEvidence ?? 0)
      )
      .map(
        ([name, { scan }]) =>
          `${name}: ${scan.figuresWithoutEvidence} StatCard/InsightTile without \`evidence\` ` +
          `(baseline ${frozen[name]?.figuresWithoutEvidence ?? 0}) — wire the number to its entries`
      );
    expect(grown).toEqual([]);
  });

  it("keeps the baseline honest — a fixed gap leaves the list", () => {
    const stale: string[] = [];
    for (const [name, gaps] of Object.entries(frozen)) {
      const found = sections.get(name);
      if (!found) {
        stale.push(`${name}: not a statistics section any more — delete its entry`);
        continue;
      }
      if (gaps.missingCountingHelp && found.scan.hasCountingHelp) {
        stale.push(`${name}: renders counting help now — delete "missingCountingHelp"`);
      }
      const frozenCount = gaps.figuresWithoutEvidence ?? 0;
      if (found.scan.figuresWithoutEvidence < frozenCount) {
        stale.push(
          `${name}: ${found.scan.figuresWithoutEvidence} figures without evidence ` +
            `(baseline ${frozenCount}) — lower "figuresWithoutEvidence"` +
            (found.scan.figuresWithoutEvidence === 0 ? " (drop it at 0)" : "")
        );
      }
      if (!gaps.missingCountingHelp && !frozenCount) {
        stale.push(`${name}: lists no gap — delete the entry`);
      }
    }
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

type Tree = { [key: string]: Tree | string };

function lookup(lang: string, fullKey: string): Tree | string | undefined {
  const [ns, path] = fullKey.split(":");
  const file = join(LOCALES, lang, `${ns}.json`);
  if (!path || !existsSync(file)) return undefined;
  let node: Tree | string | undefined = JSON.parse(readFileSync(file, "utf8")) as Tree;
  for (const part of path.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return node;
}

/**
 * The counting-help keys a source names literally: `helpKey: "…"`, the
 * insight topics of `InsightHeading`/`insightCounting`, and the
 * `countingSource(\`<prefix>${block}\`)` helpers with the blocks passed to them.
 */
export function namedHelpKeys(source: string): string[] {
  const keys = [...source.matchAll(/helpKey:\s*"([^"]+)"/g)].map((m) => m[1]);
  const topics = [
    ...[...source.matchAll(/insightCounting\(\s*"(\w+)"/g)].map((m) => m[1]),
    ...[...source.matchAll(/topic=(?:"(\w+)"|\{([^}]*)\})/g)].flatMap((m) =>
      m[1] ? [m[1]] : [...m[2].matchAll(/"(\w+)"/g)].map((s) => s[1])
    ),
  ];
  keys.push(...topics.map((topic) => `stats:insights.help.${topic}`));
  const prefix = /countingSource\(`([\w:.]+)\$\{block\}`/.exec(source)?.[1];
  if (prefix) {
    for (const m of source.matchAll(/\bhelp\(\s*"(\w+)"/g)) keys.push(`${prefix}${m[1]}.help`);
  }
  return keys;
}

describe("every counting help answers all five questions in both languages", () => {
  const named = [...sections.values()].flatMap(({ source }) => namedHelpKeys(source));

  it("finds the keys — otherwise the pattern has drifted", () => {
    expect(new Set(named).size).toBeGreaterThan(60);
  });

  it.each(["de", "en"])("%s carries unit, time, source, coverage and exclusions", (lang) => {
    const incomplete = [...new Set(named)].flatMap((key) =>
      COUNTING_FIELDS.filter((field) => {
        const node = lookup(lang, key);
        return typeof node !== "object" || typeof node[field] !== "string" || !node[field];
      }).map((field) => `${key}.${field}`)
    );
    expect(incomplete).toEqual([]);
  });
});

describe("the scan itself", () => {
  it("counts a tile without evidence, and not one with evidence or a spread", () => {
    const scan = scanSection(`
      const a = <StatCard title="x" value={1} description="" />;
      const b = <StatCard title="x" value={1} description="" evidence={e} />;
      const c = <InsightTile {...vm} />;
    `);
    expect(scan).toEqual({ figures: 3, hasCountingHelp: true, figuresWithoutEvidence: 1 });
  });

  it("counts each object of a figure grid, and the ones without evidence", () => {
    const scan = scanSection(`
      const kpis: Kpi[] = [
        { label: "a", value: 1, evidence: { key: "k", renderedValue: 1 } },
        { label: "b", value: 2 },
      ];
      const other: Row[] = [{ label: "c" }];
    `);
    expect(scan).toEqual({ figures: 2, hasCountingHelp: false, figuresWithoutEvidence: 1 });
  });

  it("counts a figure that declares itself without a primitive", () => {
    const scan = scanSection(`const a = <Link to="/x" data-stat-figure>{n}</Link>;`);
    expect(scan).toEqual({ figures: 1, hasCountingHelp: false, figuresWithoutEvidence: 0 });
  });

  it("sees counting help drawn directly or through a primitive", () => {
    expect(scanSection(`const a = <CountingHelp entries={[]} />;`).hasCountingHelp).toBe(true);
    expect(scanSection(`const a = <InsightTile help={h} />;`).hasCountingHelp).toBe(true);
    expect(scanSection(`const a = <StatCard />;`).hasCountingHelp).toBe(false);
  });

  it("reads the keys a section names", () => {
    const keys = namedHelpKeys(`
      const help = (block: string) => countingSource(\`lodging:stats.insights.\${block}\`, v);
      <InsightTile help={help("week", { n })} />;
      <CountingHelp entries={[{ term: t("x"), helpKey: "rail:stats.help.journeys" }]} />;
      <InsightHeading topic={on ? "cruiseExcursions" : "cruiseExcursionsNotes"} />;
    `);
    expect(keys.sort()).toEqual([
      "lodging:stats.insights.week.help",
      "rail:stats.help.journeys",
      "stats:insights.help.cruiseExcursions",
      "stats:insights.help.cruiseExcursionsNotes",
    ]);
  });
});
