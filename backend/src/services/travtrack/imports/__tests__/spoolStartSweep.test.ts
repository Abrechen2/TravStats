import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SPOOL_DIR, sweepSpoolAtStart } from "../spool";

/**
 * An import's points file can be as large as the whole track file. Before, a
 * crash left it (and the upload) behind until the 24 h sweep — which only ran
 * the first time an import used the directory again, if ever. Now the start
 * clears everything written before this process began; nothing an import of a
 * dead process wrote can be resumed (a resume needs the file again).
 */
describe("the travtrack import spool at start", () => {
  const made: string[] = [];
  const write = (name: string, mtimeMs: number): string => {
    fs.mkdirSync(SPOOL_DIR, { recursive: true, mode: 0o700 });
    const file = path.join(SPOOL_DIR, name);
    fs.writeFileSync(file, "x");
    fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
    made.push(file);
    return file;
  };
  afterEach(() => made.splice(0).forEach((f) => fs.rmSync(f, { force: true })));

  it("removes a points file and an upload a crashed import left an hour ago", () => {
    const startedAt = Date.now();
    const points = write(`${randomUUID()}.points.ndjson`, startedAt - 3_600_000);
    const upload = write(`${randomUUID()}.upload`, startedAt - 3_600_000);
    expect(sweepSpoolAtStart(startedAt)).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(points)).toBe(false);
    expect(fs.existsSync(upload)).toBe(false);
  });

  it("spares a file written since this process began", () => {
    const startedAt = Date.now() - 60_000;
    const fresh = write(`${randomUUID()}.upload`, Date.now());
    sweepSpoolAtStart(startedAt);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
