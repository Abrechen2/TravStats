import fs from "fs";
import path from "path";

/**
 * „Zuletzt gesehen" is the owner's alone (TravTrack plan L2): no share,
 * public link, `.travstats` file, comparison, federation or export reaches
 * it. Held by a source scan — exactly one module outside the tests may import
 * `lastSeen.ts`, the owner's own TravTrack route.
 */

const SRC = path.join(__dirname, "..", "..", "..");
const ALLOWED = [path.join("routes", "travtrack", "points.ts")];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "generated" ? [] : sources(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const importsLastSeen = (file: string) =>
  /from\s+["'][^"']*\/lastSeen["']|require\(\s*["'][^"']*\/lastSeen["']\s*\)|import\(\s*["'][^"']*\/lastSeen["']\s*\)/.test(
    fs.readFileSync(file, "utf-8")
  );

describe("last seen stands apart from everything that leaves the account", () => {
  const all = sources(SRC);

  it("is imported by the owner's TravTrack route and nothing else", () => {
    const importers = all.filter(importsLastSeen).map((f) => path.relative(SRC, f));
    expect(importers).toEqual(ALLOWED);
  });

  it("no sharing, public-link, comparison, federation, export or backup module imports it", () => {
    const guarded = [
      "services/sharing",
      "services/shareLinks",
      "services/comparison",
      "services/federation",
      "services/export",
      "services/backup",
      "services/openData",
      "routes/sharing",
      "routes/shareLinks",
      "routes/publicShareLinks",
      "routes/comparison",
    ];
    const offenders = all
      .filter((f) => guarded.some((dir) => path.relative(SRC, f).startsWith(dir)))
      .filter(importsLastSeen);
    expect(offenders).toEqual([]);
    // The scan must actually see those modules, or it proves nothing.
    expect(all.some((f) => path.relative(SRC, f).startsWith("services/sharing"))).toBe(true);
    expect(all.some((f) => path.relative(SRC, f).startsWith("services/federation"))).toBe(true);
  });
});
