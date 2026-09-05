/**
 * Generates `src/theme/tokens.css` from `design/tokens.json`.
 *
 * The JSON is the mirror of the Companion's token file and the single source of
 * truth for colour, type, radius and measure. A value that is not in it is not
 * a design decision, it is an accident — so this generator adds nothing of its
 * own except the four web-only derivations named in `design/DESIGN_SYSTEM.md`
 * §2.1 and §4.2 (a desktop has hover, focus and width; a phone has none of the
 * three), and each of those is derived from a token rather than typed in.
 *
 * Re-run via `npm run tokens`. The output is checked in and
 * `src/theme/__tests__/tokens.generated.test.ts` fails when it drifts, so
 * nobody edits it by hand.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const TOKENS_PATH = resolve(here, "../../design/tokens.json");
export const OUTPUT_PATH = resolve(here, "../src/theme/tokens.css");

/** `#f0a947` → `240, 169, 71`. Only ever called on a token value. */
function channels(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Re-alphas an ink that is already a token. Used for the web-only greys: the
 * design system allows the hairline at other opacities for an input border, a
 * secondary button and a row hover, but forbids "a fifth grey" — so they are
 * the same ink, not new ones.
 */
function realpha(rgbaOrHex, alpha) {
  if (rgbaOrHex.startsWith("rgba")) {
    return rgbaOrHex.replace(/[\d.]+\s*\)$/, `${alpha})`);
  }
  const [r, g, b] = channels(rgbaOrHex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** camelCase / snake → kebab, so `textBright` becomes `text-bright`. */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Documentation keys inside the token file, never tokens themselves. */
const isMeta = (key) => key.startsWith("_");

/**
 * Builds the stylesheet as a string. Separate from writing it so the test can
 * compare a fresh build against the checked-in file WITHOUT the act of testing
 * rewriting the thing under test — an importing test that also regenerated the
 * artefact would pass on every hand edit, which is the one case it exists for.
 */
export function buildThemeCss() {
  const tokens = JSON.parse(readFileSync(TOKENS_PATH, "utf8"));

  const lines = [];
  const theme = [];
  const push = (name, value) => lines.push(`  --ts-${name}: ${value};`);

  // ── Colour ────────────────────────────────────────────────────────────────
  lines.push("  /* Surfaces, ink, accent, semantic states — tokens.json → color */");
  for (const [key, value] of Object.entries(tokens.color)) {
    if (isMeta(key)) continue;
    push(kebab(key), value);
  }

  // The four web-only derivations. A desktop has states a phone does not, and a
  // table needs width; both are stated in DESIGN_SYSTEM.md and neither exists in
  // the Companion file. Derived from `border` and `canvas` so no new grey enters.
  lines.push("");
  lines.push(
    "  /* Web-only, DESIGN_SYSTEM.md §2.1 — the same ink at other opacities, never a new grey */"
  );
  push("border-input", realpha(tokens.color.border, 0.16));
  push("border-button", realpha(tokens.color.border, 0.18));
  push("row-hover", realpha(tokens.color.border, 0.04));
  push("scrim", realpha(tokens.color.canvas, 0.6));

  lines.push("");
  lines.push("  /* Domain colour — one hue per domain, tours included since 0.8.0 */");
  for (const [key, value] of Object.entries(tokens.domainColor)) {
    if (isMeta(key)) continue;
    push(`domain-${kebab(key)}`, value);
  }

  lines.push("");
  lines.push("  /* Status — always a pill, never plain text (DESIGN_SYSTEM.md §2.6) */");
  for (const [key, value] of Object.entries(tokens.statusColor)) {
    if (isMeta(key)) continue;
    push(`status-${kebab(key)}`, value);
  }

  lines.push("");
  lines.push("  /* The status pill recipe: colour as text, 12 % fill, 45 % border */");
  push("status-pill-bg-alpha", tokens.statusPill.bgAlpha);
  push("status-pill-border-alpha", tokens.statusPill.borderAlpha);

  lines.push("");
  lines.push("  /* Tier, chart, list */");
  for (const [key, value] of Object.entries(tokens.tierColor)) {
    if (isMeta(key)) continue;
    push(`tier-${kebab(key)}`, value);
  }
  tokens.chartColors.forEach((value, i) => push(`chart-${i + 1}`, value));
  push("chart-muted-bar", tokens.chartMutedBar);
  for (const [key, value] of Object.entries(tokens.listColor.palette)) {
    if (isMeta(key)) continue;
    push(`list-${kebab(key)}`, value);
  }

  // ── Typography ────────────────────────────────────────────────────────────
  const FALLBACK = {
    ui: "system-ui, -apple-system, Segoe UI, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    serif: "Georgia, Times New Roman, serif",
  };
  lines.push("");
  lines.push("  /* Type — one family per role, self-hosted (see theme/fonts.css) */");
  for (const [role, family] of Object.entries(tokens.typography.family)) {
    push(`font-${role}`, `"${family}", ${FALLBACK[role]}`);
  }

  // ── Space, radius, shadow, size, motion ───────────────────────────────────
  lines.push("");
  lines.push("  /* Space — 10, 14 and 28 are off Tailwind's four-pixel grid on purpose */");
  for (const [key, value] of Object.entries(tokens.spacing)) {
    if (isMeta(key)) continue;
    push(`space-${kebab(key)}`, `${value}px`);
  }

  lines.push("");
  lines.push("  /* Width — the one web-only layout decision (DESIGN_SYSTEM.md §4.2) */");
  push("width-reading", "720px");
  push("width-list", "1200px");

  lines.push("");
  lines.push("  /* Radius — no other radius exists */");
  for (const [key, value] of Object.entries(tokens.radius)) {
    if (isMeta(key)) continue;
    push(`radius-${kebab(key)}`, `${value}px`);
  }

  lines.push("");
  lines.push("  /* Shadow — four, sparingly. A card has none; it has a hairline. */");
  for (const [key, value] of Object.entries(tokens.shadow)) {
    if (isMeta(key)) continue;
    push(`shadow-${kebab(key)}`, value);
  }
  // A centred dialog is the sheet with its shadow mirrored (DESIGN_SYSTEM.md §4.4).
  push("shadow-dialog", tokens.shadow.sheet.replace("0 -14px", "0 14px"));

  lines.push("");
  lines.push("  /* Size — 44 is the minimum hit area for every pointer target */");
  for (const [key, value] of Object.entries(tokens.size)) {
    if (isMeta(key)) continue;
    push(`size-${kebab(key)}`, `${value}px`);
  }

  lines.push("");
  lines.push("  /* Motion — four numbers, decided once (tokens.json → motion) */");
  push("motion-fast", `${tokens.motion.fast}ms`);
  push("motion-base", `${tokens.motion.base}ms`);
  push("motion-enter", `${tokens.motion.enter}ms`);
  push("motion-skeleton-pulse", `${tokens.motion.skeletonPulse}ms`);
  push("ease-standard", tokens.motion.easing.standard);
  push("ease-enter", tokens.motion.easing.enter);

  lines.push("");
  lines.push("  /* Icons — Lucide, 24 grid (DESIGN_SYSTEM.md §7) */");
  push("icon-stroke", tokens.icon.stroke);
  push("icon-stroke-active", tokens.icon.strokeActive);

  // ── Tailwind @theme ───────────────────────────────────────────────────────
  // Everything is re-exported under the `ts-` prefix so `bg-ts-surface`,
  // `rounded-ts-card` and `p-ts-lg` exist as utilities. The prefix is not
  // decoration: the old palette still owns `--color-surface`, `--color-border`
  // and `--color-accent` until block 7 removes it, and two systems answering to
  // one name is exactly the drift this file exists to end.
  const themeColor = (name) => theme.push(`  --color-ts-${name}: var(--ts-${name});`);
  theme.push("  /* Colour */");
  for (const [key] of Object.entries(tokens.color)) {
    if (isMeta(key)) continue;
    themeColor(kebab(key));
  }
  for (const name of ["border-input", "border-button", "row-hover", "scrim"]) themeColor(name);
  for (const [key] of Object.entries(tokens.domainColor)) {
    if (isMeta(key)) continue;
    themeColor(`domain-${kebab(key)}`);
  }
  for (const [key] of Object.entries(tokens.statusColor)) {
    if (isMeta(key)) continue;
    themeColor(`status-${kebab(key)}`);
  }
  for (const [key] of Object.entries(tokens.tierColor)) {
    if (isMeta(key)) continue;
    themeColor(`tier-${kebab(key)}`);
  }
  tokens.chartColors.forEach((_, i) => themeColor(`chart-${i + 1}`));
  themeColor("chart-muted-bar");
  for (const [key] of Object.entries(tokens.listColor.palette)) {
    if (isMeta(key)) continue;
    themeColor(`list-${kebab(key)}`);
  }

  theme.push("");
  theme.push("  /* Type */");
  for (const role of Object.keys(tokens.typography.family)) {
    theme.push(`  --font-ts-${role}: var(--ts-font-${role});`);
  }

  theme.push("");
  theme.push("  /* Space, width, radius, shadow */");
  for (const [key] of Object.entries(tokens.spacing)) {
    if (isMeta(key)) continue;
    theme.push(`  --spacing-ts-${kebab(key)}: var(--ts-space-${kebab(key)});`);
  }
  for (const name of ["reading", "list"]) {
    theme.push(`  --container-ts-${name}: var(--ts-width-${name});`);
  }
  for (const [key] of Object.entries(tokens.radius)) {
    if (isMeta(key)) continue;
    theme.push(`  --radius-ts-${kebab(key)}: var(--ts-radius-${kebab(key)});`);
  }
  for (const [key] of Object.entries(tokens.shadow)) {
    if (isMeta(key)) continue;
    theme.push(`  --shadow-ts-${kebab(key)}: var(--ts-shadow-${kebab(key)});`);
  }
  theme.push("  --shadow-ts-dialog: var(--ts-shadow-dialog);");

  // ── Type utilities ────────────────────────────────────────────────────────
  // One class per role in `typography.scale`. The seventeen h1 variants the app
  // carries today collapse into `.t-screen-title`.
  const ROLE_COLOR = {
    hero: "text-bright",
    screenTitle: "text-bright",
    greeting: "text-bright",
    cardTitle: "text",
    statNumber: "text-bright",
    body: "text",
    caption: "muted",
    labelMono: "muted",
    metaMono: "muted",
    code: "text",
  };

  const utilities = [];
  for (const [role, spec] of Object.entries(tokens.typography.scale)) {
    const rules = [];
    const family = spec.family ?? "ui";
    rules.push(`  font-family: var(--ts-font-${family});`);
    if (spec.size) rules.push(`  font-size: ${spec.size}px;`);
    if (spec.weight) rules.push(`  font-weight: ${spec.weight};`);
    if (spec.style) rules.push(`  font-style: ${spec.style};`);
    if (spec.tracking !== undefined) {
      rules.push(
        `  letter-spacing: ${typeof spec.tracking === "number" ? `${spec.tracking}px` : spec.tracking};`
      );
    }
    if (spec.case) rules.push(`  text-transform: ${spec.case};`);
    // Every column of numbers is tabular (DESIGN_SYSTEM.md §3.2). The token says
    // so for statNumber; hero is a number too and says it in prose.
    if (spec.numeric || role === "hero") rules.push("  font-variant-numeric: tabular-nums;");
    rules.push(`  color: var(--ts-${ROLE_COLOR[role]});`);
    utilities.push(`@utility t-${kebab(role)} {\n${rules.join("\n")}\n}`);
  }

  const out = `/*
 * GENERATED by scripts/generate-theme.mjs from design/tokens.json (v${tokens.version}).
 * Do not edit by hand — run \`npm run tokens\`. A test compares this file to a
 * fresh generation, so a hand edit fails the suite rather than surviving in it.
 *
 * Everything visible in the app comes from here. A new hex in a component is a
 * defect, not a style: the value belongs in the Companion token file first and
 * reaches this one by copy.
 */

:root {
${lines.join("\n")}
}

@theme {
${theme.join("\n")}
}

/* One utility per role in typography.scale. A page heading is .t-screen-title. */
${utilities.join("\n\n")}
`;

  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, buildThemeCss(), "utf8");
  console.log("tokens.css written from design/tokens.json");
}
