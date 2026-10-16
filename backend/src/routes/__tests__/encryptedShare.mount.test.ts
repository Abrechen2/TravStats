import { apiMounts } from "../mounts";
import { listMountedEndpoints, UNDOCUMENTED_MOUNTS } from "../../services/openapi/coverage";

describe("the encrypted share lives apart from the comparison page", () => {
  it("serves the E2E cookie API under /encrypted-share", () => {
    expect(apiMounts.find((m) => m.id === "encrypted-share")?.base).toBe("/api/v1/encrypted-share");
    const served = listMountedEndpoints().map((e) => `${e.method} ${e.path}`);
    expect(served).toContain("get /encrypted-share/links");
    expect(served).toContain("post /encrypted-share/sealed/read");
    // The friendship endpoints of the E2E transfer never answer under /comparison again.
    expect(served.filter((p) => p.includes(" /comparison/links"))).toEqual([]);
  });

  it("drops the board and audit endpoints nothing ever called", () => {
    const served = listMountedEndpoints().map((e) => e.path);
    expect(
      served.filter((p) => /\/(boards|audit)$/.test(p) && p.startsWith("/encrypted-share"))
    ).toEqual([]);
  });

  it("says why the E2E API is outside the published spec", () => {
    expect(UNDOCUMENTED_MOUNTS.get("encrypted-share")).toMatch(/beta/i);
    expect(UNDOCUMENTED_MOUNTS.has("comparison")).toBe(false);
  });
});
