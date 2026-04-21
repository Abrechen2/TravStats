#!/usr/bin/env node
/**
 * searoute-ts ships as ESM but uses extensionless internal imports
 * (`from './lib/utils'`) which Node's ESM loader rejects, and contains
 * a stray `console.log(nearestLineIndex)` that spams every request.
 *
 * This script patches both issues in `node_modules/searoute-ts/dist/`
 * after `npm install`. Idempotent — safe to run on already-patched files.
 *
 * Run via the `postinstall` hook in `package.json`.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "searoute-ts",
  "dist",
  "index.js",
);

async function patch() {
  let source;
  try {
    source = await readFile(INDEX_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      // searoute-ts not installed yet (e.g. `npm install` still running
      // for a different workspace). Nothing to patch.
      return;
    }
    throw err;
  }

  let patched = source;

  // 1. Extensionless internal import: `from './lib/utils'` → `from './lib/utils.js'`.
  patched = patched.replace(
    /from ['"]\.\/lib\/utils['"]/g,
    "from './lib/utils.js'",
  );

  // 2. Drop the `console.log(nearestLineIndex);` debug statement.
  patched = patched.replace(/\n\s*console\.log\(nearestLineIndex\);\s*\n/g, "\n");

  if (patched === source) {
    return; // Already patched.
  }

  await writeFile(INDEX_PATH, patched, "utf8");
  process.stdout.write(`[patch-searoute-ts] patched ${INDEX_PATH}\n`);
}

patch().catch((err) => {
  process.stderr.write(`[patch-searoute-ts] failed: ${err.stack ?? err}\n`);
  process.exit(1);
});
