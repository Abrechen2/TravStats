import fs from "fs";
import path from "path";

/**
 * `shared/logContract.ts` is the one wire contract of the admin log area and
 * the diagnostic export. Its frontend mirror must be the SAME file: the drift
 * it replaced shipped a cleanup toast reading "undefined files, NaN MB".
 * Unlike the other mirrors in `shared/`, this one is checked.
 */
describe("logContract mirror", () => {
  it("is byte-identical in backend and frontend (line endings aside)", () => {
    const read = (p: string) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    const backend = read(path.join(__dirname, "..", "logContract.ts"));
    const frontend = read(
      path.join(__dirname, "..", "..", "..", "..", "frontend", "src", "shared", "logContract.ts")
    );
    expect(frontend).toBe(backend);
  });
});
