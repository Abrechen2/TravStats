import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * Every path that CREATES a place visit enqueues the visit's automatic photo
 * pass (`scheduleVisitAutoLink`), so a visit made by the Companion capture, a
 * trip suggestion, a photo finding, a stay review, a checklist tick, a sheet
 * import or a trip import links its photos like one made in the web. A path
 * that creates visits without the call fails here; a file that must not carries
 * a written reason below. Source scanner: it proves the file calls the
 * scheduler, and `placeVisitPhotoAuto.test.ts` proves the scheduler links.
 */
const SRC = join(__dirname, "../../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ["__tests__", "generated", "seedDemo", "scripts"].includes(name) ? [] : sources(path);
    }
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const EXEMPT: Record<string, string> = {};

const creators = sources(SRC)
  .filter((p) => /placeVisit\.create(Many)?\(/.test(readFileSync(p, "utf8")))
  .map((p) => relative(SRC, p));

describe("place visit creation paths enqueue the automatic photo pass", () => {
  it("finds the known creators", () => {
    expect(creators.length).toBeGreaterThanOrEqual(8);
  });

  it.each(creators)("%s", (file) => {
    if (EXEMPT[file]) return;
    expect(readFileSync(join(SRC, file), "utf8")).toContain("scheduleVisitAutoLink(");
  });
});
