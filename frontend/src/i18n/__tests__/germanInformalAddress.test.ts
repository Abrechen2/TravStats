import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Issue #236. The German copy mixed formal "Sie" and informal "du", including
 * within a single view — the setup wizard, the first screen anyone sees, had
 * both ("Erstellen Sie Ihr Admin-Konto" next to "Was möchtest du tracken?").
 *
 * Owner decision 2026-08-09: informal "du" throughout. This is a personal,
 * self-hosted travel logbook; "Sie" reads distant, and the newer copy had
 * already drifted informal.
 *
 * This guard exists because the drift is invisible one string at a time: a
 * single formal sentence added later looks fine in its own diff and only
 * shows up as inconsistency in the running UI.
 */

const DE_DIR = path.join(__dirname, "..", "resources", "de");

/**
 * Capitalised "Sie/Ihr..." is ambiguous in German: it is the formal address,
 * but also legitimate third person ("sie" = they/she) at the start of a
 * sentence, and the possessive "ihre" for a third party. Each entry here is a
 * reviewed exception, not a blanket mute — keep this list short and justified.
 */
const ALLOWED: Array<{ file: string; fragment: string; why: string }> = [
  {
    file: "admin.json",
    fragment: "Ihre Schlüssel haben Vorrang vor globalen Schlüsseln.",
    why: "third person: the USERS' keys, in a sentence about what users may enter",
  },
  {
    file: "immich.json",
    fragment: "Sie lassen sich erst bearbeiten, wenn sie geladen sind.",
    why: "third person plural: the SETTINGS, not the reader",
  },
];

const FORMAL = /\b(Sie|Ihre|Ihr|Ihnen|Ihrem|Ihren|Ihrer|Ihres)\b/;

describe("German UI uses informal address (#236)", () => {
  const files = fs.readdirSync(DE_DIR).filter((f) => f.endsWith(".json"));

  it("has German locale files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s contains no formal address", (file) => {
    const raw = fs.readFileSync(path.join(DE_DIR, file), "utf-8");
    const offenders: string[] = [];

    for (const line of raw.split("\n")) {
      if (!FORMAL.test(line)) continue;
      const excused = ALLOWED.some((a) => a.file === file && line.includes(a.fragment));
      if (!excused) offenders.push(line.trim());
    }

    expect(offenders, `Formal address found in ${file}:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keeps every allowlist entry real — a stale exception is a silent hole", () => {
    for (const entry of ALLOWED) {
      const raw = fs.readFileSync(path.join(DE_DIR, entry.file), "utf-8");
      expect(raw, `Allowlisted fragment no longer present in ${entry.file}: ${entry.why}`).toContain(
        entry.fragment
      );
    }
  });
});
