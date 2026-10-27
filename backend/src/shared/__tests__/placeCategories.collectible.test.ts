import { isCollectiblePlaceCategory } from "../placeCategories";

/**
 * forgejo#299 left a service area out of "categories used" — and nothing else.
 * Places imported with a category of their own (a Google Takeout place keeps
 * its label) were counted before and must still count; the first cut of the
 * rule dropped every category outside the built-in list.
 */
describe("isCollectiblePlaceCategory", () => {
  it("leaves out the transit category", () => {
    expect(isCollectiblePlaceCategory("service_area")).toBe(false);
  });

  it("collects a built-in category", () => {
    expect(isCollectiblePlaceCategory("museum")).toBe(true);
  });

  it("collects a category of the place's own, as it did before", () => {
    expect(isCollectiblePlaceCategory("food")).toBe(true);
    expect(isCollectiblePlaceCategory("beach")).toBe(true);
  });

  it("collects nothing for a missing category", () => {
    expect(isCollectiblePlaceCategory("")).toBe(false);
    expect(isCollectiblePlaceCategory(null)).toBe(false);
    expect(isCollectiblePlaceCategory(undefined)).toBe(false);
  });
});
