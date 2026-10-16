import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import i18n from "../../../i18n/config";

const SRC = path.join(__dirname, "..", "..", "..");

function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("the encrypted share stands apart from the leaderboard", () => {
  it("speaks its own namespace in both languages", () => {
    expect(i18n.hasResourceBundle("de", "encryptedShare")).toBe(true);
    expect(i18n.hasResourceBundle("en", "encryptedShare")).toBe(true);
  });

  it("is never imported by the leaderboard", () => {
    // pages/ComparisonPage.tsx is left out on purpose: it is the route dispatcher for both pages
    // and loads the encrypted share lazily, so it never joins the leaderboard's chunk.
    const leaderboard = [
      ...sources(path.join(SRC, "components", "comparison")),
      ...sources(path.join(SRC, "lib", "comparison")),
      path.join(SRC, "lib", "api", "comparison.ts"),
    ].filter((file) => fs.existsSync(file));
    const offenders = leaderboard.filter((file) =>
      /encryptedShare/.test(fs.readFileSync(file, "utf-8"))
    );
    expect(offenders).toEqual([]);
  });
});
