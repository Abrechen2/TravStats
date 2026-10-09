/**
 * validate-template-repo.ts — checks a clone of the template repository
 * (github.com/Abrechen2/travstats-templates) exactly as the app would load it,
 * WITHOUT touching the bundled snapshot.
 *
 * For every template the root `index.json` names: the file exists, is JSON,
 * passes the one v2 envelope validator (`services/parsers/templates/v2/
 * envelope.ts`), agrees with its index line (id, domain, version), and every
 * one of its own test cases passes on the same engine the app runs. A `.json`
 * file in a domain folder that the index does not name is reported too — an
 * unindexed template is one no instance will ever load.
 *
 *   cd backend && npx tsx scripts/validate-template-repo.ts <template-repo-clone>
 *
 * Exit code 0 when everything passes, 1 on any failure, 2 on bad usage. The
 * template repository's own `scripts/validate.mjs` calls this script.
 */
import path from "path";
import { validateRepository } from "../src/services/parsers/templates/v2/snapshotSync";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx scripts/validate-template-repo.ts <template-repo-clone>");
  process.exit(2);
}

const report = validateRepository(path.resolve(dir));
for (const rel of report.unindexed) report.failures.push(`${rel}: not named in index.json`);
if (report.failures.length > 0) {
  console.error(`${report.failures.length} problem(s):`);
  for (const failure of report.failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`${report.entries.length} template(s) valid; every test case passed.`);
