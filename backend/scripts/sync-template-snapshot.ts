/**
 * sync-template-snapshot.ts — refreshes the bundled v2 template snapshot
 * (`src/services/parsers/templates/v2/snapshot/`) from a local clone of the
 * template repository (github.com/Abrechen2/travstats-templates).
 *
 * The snapshot is what a fresh or offline instance reads issuer documents
 * with (plan 2026-10-09 P4a). Every template the clone's root `index.json`
 * names is validated and its own test cases are run first; one failure and
 * nothing is written. Files are copied byte for byte, and a file the index no
 * longer names is removed from the snapshot.
 *
 *   cd backend && npx tsx scripts/sync-template-snapshot.ts --from ../../travstats-templates
 *
 * Commit the result like any other data change; `prettier --check` covers the
 * copied JSON, so format the repository's files with the app's Prettier.
 */
import path from "path";
import { syncSnapshot } from "../src/services/parsers/templates/v2/snapshotSync";
import { DEFAULT_SNAPSHOT_DIR } from "../src/services/parsers/templates/v2/snapshot";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const from = arg("--from");
if (!from) {
  console.error("usage: npx tsx scripts/sync-template-snapshot.ts --from <template-repo-clone>");
  process.exit(2);
}

const report = syncSnapshot(path.resolve(from), DEFAULT_SNAPSHOT_DIR);
if (report.failures.length > 0) {
  console.error("Snapshot NOT updated:");
  for (const failure of report.failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Snapshot updated: ${report.copied.length} template(s) copied.`);
for (const rel of report.removed) console.log(`  removed ${rel}`);
