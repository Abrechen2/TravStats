import { describe, it, expect } from "vitest";
import de from "../resources/de/settings.json";
import en from "../resources/en/settings.json";
import { autoSaveKey } from "../../pages/SettingsPage";

const resources = import.meta.glob("../resources/{de,en}/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

describe("settings wording", () => {
  it("does not promise that everything saves itself on a page with a save button", () => {
    expect(autoSaveKey("account", "idle")).toBe("idleWithButtons");
    expect(autoSaveKey("display", "idle")).toBe("idle");
    expect(autoSaveKey("account", "saving")).toBe("saving");
    expect(de.autoSave.idleWithButtons).toMatch(/Knopf/);
    expect(en.autoSave.idleWithButtons).toMatch(/button/);
  });

  it("calls the domains page 'Reisearten' everywhere, never 'Bereiche & Farben'", () => {
    for (const [file, raw] of Object.entries(resources)) {
      expect(raw, file).not.toMatch(/Bereiche & Farben|Domains & colours|Settings → Areas/);
    }
    expect(de.domainOff.action).toContain("Reisearten");
    expect(en.domainOff.action).toContain("Travel types");
  });
});
