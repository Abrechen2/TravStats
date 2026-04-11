#!/usr/bin/env node
/**
 * Audit help-text i18n coverage across the TravStats frontend.
 *
 * Walks every .tsx file under frontend/src, extracts every <InlineHelp ...>
 * and <HelpIcon ...> element (self-closing or block form, JSX-brace-aware),
 * pulls every t("ns:key.path") reference from inside those elements, and
 * verifies each key exists in both de/<ns>.json and en/<ns>.json.
 *
 * Also checks the hardcoded i18n keys used internally by the Help
 * components themselves against the common namespace.
 *
 * Run from repo root:  node scripts/audit-inline-help.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FRONTEND = path.join(ROOT, "frontend", "src");
const I18N = path.join(FRONTEND, "i18n", "resources");

// Keys hardcoded inside the Help components themselves.
const INTERNAL_HELP_KEYS = [
  { key: "common:help.more", usedBy: "components/Help/InlineHelp.tsx" },
  { key: "common:help.less", usedBy: "components/Help/InlineHelp.tsx" },
  { key: "common:help.clickForMore", usedBy: "components/Help/HelpIcon.tsx" },
  { key: "common:buttons.close", usedBy: "components/Help/HelpIcon.tsx" },
  { key: "common:accessibility.showHelp", usedBy: "components/Help/HelpIcon.tsx" },
];

const jsonCache = new Map();
function loadNamespace(lang, ns) {
  const key = `${lang}:${ns}`;
  if (jsonCache.has(key)) return jsonCache.get(key);
  const file = path.join(I18N, lang, `${ns}.json`);
  if (!fs.existsSync(file)) {
    jsonCache.set(key, null);
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    jsonCache.set(key, data);
    return data;
  } catch (e) {
    console.error(`Failed to parse ${file}: ${e.message}`);
    jsonCache.set(key, null);
    return null;
  }
}

function resolvePath(obj, dotted) {
  if (!obj) return undefined;
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

function keyStatus(keyRef) {
  if (!keyRef.includes(":")) return { ok: false, reason: "unscoped (no ns prefix)" };
  const [ns, dotted] = keyRef.split(":", 2);
  const de = loadNamespace("de", ns);
  const en = loadNamespace("en", ns);
  if (de === null && en === null) return { ok: false, reason: `namespace ${ns} not found` };
  const inDe = resolvePath(de, dotted) !== undefined;
  const inEn = resolvePath(en, dotted) !== undefined;
  if (inDe && inEn) return { ok: true };
  if (!inDe && !inEn) return { ok: false, reason: "missing in DE + EN" };
  if (!inDe) return { ok: false, reason: "missing in DE" };
  return { ok: false, reason: "missing in EN" };
}

// JSX element extractor: finds every <TagName ... /> or <TagName ...>...</TagName>
// with JSX-brace awareness so multi-line content with nested { } doesn't confuse
// the boundary detection.
function extractElements(source, tagName) {
  const OPEN = `<${tagName}`;
  const CLOSE = `</${tagName}>`;
  const out = [];
  let idx = 0;
  while (true) {
    const start = source.indexOf(OPEN, idx);
    if (start === -1) break;
    // Require the char right after to be whitespace or / or > so we don't match
    // "<HelpIconButton" when looking for "<HelpIcon".
    const afterTag = source[start + OPEN.length];
    if (afterTag && !/[\s/>]/.test(afterTag)) {
      idx = start + OPEN.length;
      continue;
    }
    let i = start + OPEN.length;
    let braceDepth = 0;
    let inString = null;
    let inLineComment = false;
    let end = -1;

    while (i < source.length) {
      const ch = source[i];
      const next = source[i + 1];
      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        i++;
        continue;
      }
      if (inString) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inString) inString = null;
        i++;
        continue;
      }
      if (ch === "/" && next === "/") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        i++;
        continue;
      }
      if (ch === "{") {
        braceDepth++;
        i++;
        continue;
      }
      if (ch === "}") {
        braceDepth--;
        i++;
        continue;
      }
      if (braceDepth === 0) {
        if (ch === "/" && next === ">") {
          end = i + 2;
          break;
        }
        if (ch === ">") {
          const close = source.indexOf(CLOSE, i);
          if (close === -1) break;
          end = close + CLOSE.length;
          break;
        }
      }
      i++;
    }
    if (end === -1) break;
    out.push(source.slice(start, end));
    idx = end;
  }
  return out;
}

function extractTKeys(source) {
  const out = new Set();
  const re = /\bt\(\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  return Array.from(out);
}

// Walk frontend/src for every .tsx file (excluding tests).
function* walkTsx(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      yield* walkTsx(full);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      yield full;
    }
  }
}

const results = [];
let totalKeys = 0;
let totalMissing = 0;

for (const file of walkTsx(FRONTEND)) {
  const src = fs.readFileSync(file, "utf8");
  const inlineBlocks = extractElements(src, "InlineHelp");
  const iconBlocks = extractElements(src, "HelpIcon");
  if (inlineBlocks.length === 0 && iconBlocks.length === 0) continue;

  const rel = path.relative(FRONTEND, file).replace(/\\/g, "/");
  const keys = new Set();
  for (const block of [...inlineBlocks, ...iconBlocks]) {
    for (const k of extractTKeys(block)) keys.add(k);
  }
  const fileKeys = Array.from(keys).sort();
  const missing = [];
  for (const k of fileKeys) {
    const s = keyStatus(k);
    if (!s.ok) missing.push({ key: k, reason: s.reason });
  }
  totalKeys += fileKeys.length;
  totalMissing += missing.length;
  results.push({
    file: rel,
    inline: inlineBlocks.length,
    icon: iconBlocks.length,
    keyCount: fileKeys.length,
    missing,
  });
}

console.log("=== Help component i18n audit (full frontend sweep) ===\n");

for (const r of results) {
  const status = r.missing.length === 0 ? "✅" : "❌";
  console.log(
    `${status} ${r.file}  [InlineHelp: ${r.inline}, HelpIcon: ${r.icon}, keys: ${r.keyCount}]`
  );
  for (const m of r.missing) {
    console.log(`     - ${m.key}  [${m.reason}]`);
  }
}

console.log("\n--- Internal Help component keys (common namespace) ---");
for (const { key, usedBy } of INTERNAL_HELP_KEYS) {
  const s = keyStatus(key);
  console.log(`${s.ok ? "✅" : "❌"} ${key}  (${usedBy})${s.ok ? "" : `  [${s.reason}]`}`);
  if (!s.ok) totalMissing += 1;
}

console.log("\n=== Summary ===");
console.log(`Components with help:   ${results.length}`);
console.log(`Total keys checked:     ${totalKeys + INTERNAL_HELP_KEYS.length}`);
console.log(`Total missing/broken:   ${totalMissing}`);
process.exit(totalMissing > 0 ? 1 : 0);
