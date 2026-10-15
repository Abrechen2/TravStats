import { afterEach, expect, it } from "vitest";
import { mapStyleUrl } from "./mapStyles";
afterEach(() => {
  delete window.__TRAVSTATS_MAP_CONFIG__;
});
it("uses OpenFreeMap for saved style IDs", () => {
  expect(mapStyleUrl("dark")).toBe("https://tiles.openfreemap.org/styles/dark");
  expect(mapStyleUrl("voyager")).toBe("https://tiles.openfreemap.org/styles/bright");
});
it("uses the server configuration", () => {
  window.__TRAVSTATS_MAP_CONFIG__ = {
    version: 1,
    styles: { dark: "https://maps.example.com/dark" },
  };
  expect(mapStyleUrl("dark")).toBe("https://maps.example.com/dark");
  expect(mapStyleUrl("light")).toBe("https://tiles.openfreemap.org/styles/positron");
});
