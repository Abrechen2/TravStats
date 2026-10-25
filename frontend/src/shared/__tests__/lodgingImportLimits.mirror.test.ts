import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

describe("lodging import commit limits", () => {
  it("are byte-identical on both sides", () => {
    const read = (file: string) => fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
    const front = read(path.join(__dirname, "..", "lodgingImportLimits.ts"));
    const back = read(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "backend",
        "src",
        "shared",
        "lodgingImportLimits.ts"
      )
    );
    expect(front).toBe(back);
  });
});
