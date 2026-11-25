import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SPOOL_DIR, SPOOL_ROOT, sweepSpoolAtStart } from "../spool";

/**
 * An import's points file can be as large as the whole track file. Before, a
 * crash left it (and the upload) behind until the 24 h sweep — which only ran
 * the first time an import used the directory again, if ever. Now the start
 * clears what processes that are gone left; nothing an import of a dead
 * process wrote can be resumed (a resume needs the file again). The root is
 * shared, so a living process's directory is never touched.
 */
describe("the travtrack import spool at start", () => {
  const made: string[] = [];
  const dir = (name: string): string => {
    const d = path.join(SPOOL_ROOT, name);
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(d, `${randomUUID()}.points.ndjson`), "x");
    made.push(d);
    return d;
  };
  afterEach(() => made.splice(0).forEach((f) => fs.rmSync(f, { recursive: true, force: true })));

  it("removes the directory of a process that is gone, with its points file and upload", () => {
    // No process runs as pid 2^22 + 1 (beyond Linux's pid_max default).
    const dead = dir(`${2 ** 22 + 1}-deadbeef`);
    expect(sweepSpoolAtStart()).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(dead)).toBe(false);
  });

  it("removes an earlier run's directory under this process's own id (a container's pid 1)", () => {
    const earlier = dir(`${process.pid}-earlier0`);
    sweepSpoolAtStart();
    expect(fs.existsSync(earlier)).toBe(false);
  });

  it("leaves a living process's directory and its own alone", () => {
    const living = dir(`${process.ppid}-living00`);
    fs.mkdirSync(SPOOL_DIR, { recursive: true });
    const own = path.join(SPOOL_DIR, `${randomUUID()}.upload`);
    fs.writeFileSync(own, "x");
    made.push(own);
    sweepSpoolAtStart();
    expect(fs.existsSync(living)).toBe(true);
    expect(fs.existsSync(own)).toBe(true);
  });

  it("removes a file of the earlier flat layout written before this process began", () => {
    const startedAt = Date.now();
    fs.mkdirSync(SPOOL_ROOT, { recursive: true });
    const flat = path.join(SPOOL_ROOT, `${randomUUID()}.points.ndjson`);
    fs.writeFileSync(flat, "x");
    fs.utimesSync(flat, (startedAt - 3_600_000) / 1000, (startedAt - 3_600_000) / 1000);
    made.push(flat);
    sweepSpoolAtStart(startedAt);
    expect(fs.existsSync(flat)).toBe(false);
  });
});
