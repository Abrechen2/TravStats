import { Readable } from "stream";

import fs from "fs";
import os from "os";
import path from "path";

import { ArchiveReader, splitLines } from "../zipReader";
import { writeZip } from "./archiveHelpers";

/** forgejo#433: one huge line must not be buffered past the cap (security review). */
describe("account archive line splitter", () => {
  const lines = async (chunks: string[], max: number) => {
    const out: string[] = [];
    for await (const l of splitLines(
      Readable.from(chunks.map((c) => Buffer.from(c))),
      "data/x.jsonl",
      max
    )) {
      out.push(l);
    }
    return out;
  };

  it("splits lines across chunk borders", async () => {
    expect(await lines(['{"a":1}\n{"b"', ':2}\n{"c":3}'], 100)).toEqual([
      '{"a":1}',
      '{"b":2}',
      '{"c":3}',
    ]);
  });

  it("refuses a line longer than the cap as an invalid archive, before it ends", async () => {
    await expect(lines(["x".repeat(60), "x".repeat(60)], 100)).rejects.toMatchObject({
      code: "ACCOUNT_ARCHIVE_INVALID",
    });
    await expect(lines(["x".repeat(150) + "\n"], 100)).rejects.toMatchObject({
      code: "ACCOUNT_ARCHIVE_INVALID",
    });
  });

  it("refuses an archive with more entries than allowed, before reading them", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "az-zip-"));
    const file = path.join(dir, "many.zip");
    await writeZip(file, new Map(Array.from({ length: 5 }, (_, i) => [`e${i}`, Buffer.from("x")])));
    await expect(ArchiveReader.open(file, 2)).rejects.toMatchObject({
      code: "ACCOUNT_ARCHIVE_INVALID",
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
