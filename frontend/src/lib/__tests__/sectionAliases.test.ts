import { describe, it, expect } from "vitest";
import { normalizeSectionId } from "../sectionAliases";

describe("normalizeSectionId", () => {
  it("maps the admin's legacy id to the new one", () => {
    expect(normalizeSectionId("apiKeys")).toBe("externalServices");
  });

  it("maps the settings page's legacy id, which is spelled differently", () => {
    // AdminPage used "apiKeys", SettingsPage used "apikeys" (lowercase k).
    // Both are in the wild in bookmarks; both must survive.
    expect(normalizeSectionId("apikeys")).toBe("externalServices");
  });

  it("passes every other id through untouched", () => {
    expect(normalizeSectionId("system")).toBe("system");
    expect(normalizeSectionId("cruisePreferences")).toBe("cruisePreferences");
    expect(normalizeSectionId("externalServices")).toBe("externalServices");
  });

  it("passes null and the empty string through", () => {
    // The hash read site does `window.location.hash.slice(1)`, which is "" when
    // there is no hash — it must stay falsy, not become a section.
    expect(normalizeSectionId(null)).toBeNull();
    expect(normalizeSectionId("")).toBe("");
  });
});
