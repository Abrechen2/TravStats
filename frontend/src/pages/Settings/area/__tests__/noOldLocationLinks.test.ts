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

/** A source without its comments: a comment may still name an old address to explain it. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Pages and tabs of the two surfaces the settings area replaced (settings v3 S6). */
const OLD_SETTINGS_PAGE =
  /["'`]\/settings\/(account|display|data|services|travtrack|loyalty|trips|domains|sharing|privacy|server|views|location|flight|cruise)(?![-\w])/;
const OLD_SETTINGS_QUERY = /["'`]\/settings\?section=/;
const OLD_SETTINGS_MODULES = /["'`]\/settings#modules/;
const OLD_ADMIN = /["'`]\/admin(?:[?"'`]|\/(?!reseed))/;

/** Files whose `/admin/...` or `/settings/...` strings are API paths, not screens. */
const API_PATHS = [
  "/lib/api/",
  "/components/Admin/AirlineLogoRefreshButton.tsx",
  "/components/ServerPages/useCatalogueReseed.ts",
];

describe("settings links", () => {
  it("no screen links to an address of the old /settings/<page> or /admin surface (use the page ids)", () => {
    const offenders = sources(SRC).filter((f) => {
      if (f.endsWith("redirects.ts") || f.endsWith("App.tsx")) return false;
      if (API_PATHS.some((p) => f.includes(p))) return false;
      const text = code(f);
      return (
        OLD_SETTINGS_PAGE.test(text) ||
        OLD_SETTINGS_QUERY.test(text) ||
        OLD_SETTINGS_MODULES.test(text) ||
        OLD_ADMIN.test(text)
      );
    });
    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });

  it("no screen links to /settings/location any more (use /settings/travtrack)", () => {
    const offenders = sources(SRC).filter(
      (f) =>
        !f.endsWith("redirects.ts") &&
        /["'`]\/settings\/location(?![-\w])/.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });
});
