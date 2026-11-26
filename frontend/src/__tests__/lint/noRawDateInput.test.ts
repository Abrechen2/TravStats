import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One date input (rc.47). 105 places wrote `<input type="date">`,
 * `datetime-local` or `time` themselves: each with its own width, its own
 * dark-mode patch (`DARK_PICKER_STYLE`), its own idea of a label, and none of
 * them knew the profile zone. They all go through `components/ui/DateField`
 * (a single day, date-time or time) or `DateRangeField` (from/to with the quick
 * picks) now. Refused outside `components/ui/`: a literal date-ish `type`
 * on any element. Ratchet baseline: zero.
 */
const SRC = resolve(__dirname, "../..");
const UI_DIR = "components/ui/";

const RAW_DATE_TYPE =
  /\btype=(?:"(?:date|datetime-local|time)"|\{[^}]*["'](?:date|datetime-local|time)["'])/g;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "generated") continue;
      out.push(...sources(path));
    } else if (/\.tsx$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

export function findRawDateInputs(source: string): string[] {
  return [...source.matchAll(RAW_DATE_TYPE)].map((m) => m[0]);
}

describe("no raw date input", () => {
  it("the scan catches each raw form and lets the shared field through", () => {
    expect(findRawDateInputs('<input type="date" />')).toHaveLength(1);
    expect(findRawDateInputs('<Input type="datetime-local" />')).toHaveLength(1);
    expect(findRawDateInputs('<input type="time" />')).toHaveLength(1);
    expect(findRawDateInputs('<input type={dayOnly ? "date" : "datetime-local"} />')).toHaveLength(
      1
    );
    expect(findRawDateInputs('<DateField kind="datetime-local" />')).toHaveLength(0);
    expect(findRawDateInputs('<input type="text" />')).toHaveLength(0);
  });

  it("no component outside components/ui writes its own date input", () => {
    const hits = sources(SRC)
      .filter((file) => !relative(SRC, file).startsWith(UI_DIR))
      .flatMap((file) =>
        findRawDateInputs(readFileSync(file, "utf8")).map((m) => `${relative(SRC, file)}: ${m}`)
      );
    expect(hits).toEqual([]);
  });
});
