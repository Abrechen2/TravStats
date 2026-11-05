import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The Standort page became TravTrack; a link still pointing at it costs a redirect hop and loses its section. */
const SRC = join(__dirname, "../../../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("settings links", () => {
  it("no screen links to /settings/location any more (use /settings/travtrack)", () => {
    const offenders = sources(SRC).filter(
      (f) =>
        !f.endsWith("redirects.ts") &&
        /["'`]\/settings\/location(?![-\w])/.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });
});
