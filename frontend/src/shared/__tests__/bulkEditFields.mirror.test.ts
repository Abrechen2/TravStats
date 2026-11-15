import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

describe("bulk-edit field registry", () => {
  it("is byte-identical on both sides", () => {
    const read = (file: string) => fs.readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
    const front = read(path.join(__dirname, "..", "bulkEditFields.ts"));
    const back = read(
      path.join(__dirname, "..", "..", "..", "..", "backend", "src", "shared", "bulkEditFields.ts")
    );
    expect(front).toBe(back);
  });
});
