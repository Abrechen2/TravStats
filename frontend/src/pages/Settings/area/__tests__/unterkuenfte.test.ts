import { describe, expect, it } from "vitest";
import { AREA_MENU, INDENTED_PAGES, findAreaPage } from "../areaModel";

/**
 * Settings v3: stays get a page of their own, "Unterkünfte", for the rating
 * categories that only the stay editor could reach. Like Flüge and
 * Kreuzfahrten it belongs to a travel type, so it exists only while that type
 * is switched on (the page's domain), and sits under Reisearten.
 */
describe("the Unterkünfte page", () => {
  it("is a Mein Konto page tied to the lodging domain, so it is not drawn while stays are off", () => {
    const page = findAreaPage("unterkuenfte");
    expect(page).toBeDefined();
    expect(page?.area).toBe("konto");
    expect(page?.domain).toBe("lodging");
    expect(AREA_MENU.find((g) => g.id === "konto")?.pages).toContain("unterkuenfte");
  });

  it("mounts the rating categories and is indented under Reisearten like the other travel-type pages", () => {
    expect(findAreaPage("unterkuenfte")?.sections.map((s) => s.id)).toEqual(["lodgingRatings"]);
    expect(INDENTED_PAGES.has("unterkuenfte")).toBe(true);
  });
});
