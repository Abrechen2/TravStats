import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DEFAULT_SNAPSHOT_DIR } from "../snapshot";

/**
 * tsc compiles .ts only, and the snapshot loader reads a missing directory as
 * an empty snapshot — on purpose, so a dev checkout without one still boots.
 * That makes a forgotten COPY invisible: the image would read every hotel and
 * airline confirmation as nothing until its first template sync. Measured
 * before P4a: the v1 `airlines/` directory had no such line, so the image
 * never shipped the built-in airline templates at all.
 */
describe("the bundled template snapshot in the image", () => {
  it("is copied next to the compiled loader", () => {
    const dockerfile = fs.readFileSync(
      path.resolve(__dirname, "../../../../../../../Dockerfile"),
      "utf-8"
    );
    expect(dockerfile).toMatch(
      /^COPY --from=backend-builder \/app\/backend\/src\/services\/parsers\/templates\/v2\/snapshot \.\/dist\/services\/parsers\/templates\/v2\/snapshot$/m
    );
    expect(DEFAULT_SNAPSHOT_DIR.replace(/\\/g, "/")).toMatch(
      /services\/parsers\/templates\/v2\/snapshot$/
    );
    expect(fs.existsSync(path.join(DEFAULT_SNAPSHOT_DIR, "index.json"))).toBe(true);
  });
});
