import { describe, it, expect } from "vitest";
import { toPortLabel } from "./portLabel";

describe("toPortLabel", () => {
  it("keeps a short mixed-case name unchanged", () => {
    expect(toPortLabel("Funchal")).toBe("Funchal");
    expect(toPortLabel("Civitavecchia")).toBe("Civitavecchia");
  });

  it("title-cases an ALL-CAPS name (LOCODE-style dump)", () => {
    expect(toPortLabel("KIEL")).toBe("Kiel");
    expect(toPortLabel("PORT SAID")).toBe("Port Said");
  });

  it("leaves interior capitals in genuine mixed-case names alone", () => {
    expect(toPortLabel("McMurdo")).toBe("McMurdo");
    expect(toPortLabel("La Coruña")).toBe("La Coruña");
  });

  it("truncates an over-long name with an ellipsis", () => {
    // "Porto Di Genova" is 15 chars → 13 kept + ellipsis = 14 chars.
    const out = toPortLabel("Kungsholmen-Stockholm");
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(14);
  });

  it("does not leave a dangling space before the ellipsis", () => {
    // Cut point lands on a space → trimmed away before appending "…".
    expect(toPortLabel("Palma de Mallorca")).toBe("Palma de Mall…");
    expect(toPortLabel("Santa Cruz de Tenerife")).not.toMatch(/ …$/);
  });

  it("respects a custom max length", () => {
    expect(toPortLabel("Barcelona", 5)).toBe("Barc…");
  });

  it("returns empty string for blank input", () => {
    expect(toPortLabel("")).toBe("");
    expect(toPortLabel("   ")).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(toPortLabel("  Kiel  ")).toBe("Kiel");
  });
});
