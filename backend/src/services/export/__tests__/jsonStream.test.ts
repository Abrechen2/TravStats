import { PassThrough } from "stream";

import { describe, it, expect } from "@jest/globals";

import { jsonChunks, jsonReadable, LazyArray, pipeJsonToResponse } from "../jsonStream";

async function collect(value: unknown): Promise<string> {
  let out = "";
  for await (const piece of jsonChunks(value)) out += piece;
  return out;
}

async function* gen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("streamed export JSON (forgejo#355)", () => {
  it("is byte-identical to JSON.stringify of the materialised structure", async () => {
    const points = [
      { id: "a", seq: "1", t: new Date("2026-10-12T03:00:00Z"), lat: 37.5, links: [] },
      { id: "b", seq: "2", t: new Date("2026-10-12T03:01:00Z"), lat: null, links: [{ kind: "x" }] },
    ];
    const shape = (pts: unknown) => ({
      format: "travstats-account-export/1",
      user: { id: "u", name: 'a "quoted"   name', skipped: undefined, nested: [1, undefined] },
      travtrack: { points: pts, zones: [], gaps: [{ at: new Date(0) }] },
    });
    const streamed = await collect(shape(new LazyArray(() => gen(points))));
    expect(streamed).toBe(JSON.stringify(shape(points)));
    expect(JSON.parse(streamed).travtrack.points).toHaveLength(2);
  });

  it("writes an empty lazy array as []", async () => {
    expect(await collect({ points: new LazyArray(() => gen([])) })).toBe('{"points":[]}');
  });

  it("serialises the lazy array twice from the source (re-iterable)", async () => {
    const lazy = new LazyArray(() => gen([1, 2]));
    expect(await collect(lazy)).toBe("[1,2]");
    expect(await collect(lazy)).toBe("[1,2]");
  });

  it("never holds the source: items are pulled one at a time while output is consumed", async () => {
    let pulled = 0;
    const lazy = new LazyArray(async function* () {
      for (let i = 0; i < 100000; i++) {
        pulled++;
        yield { i };
      }
    });
    const stream = jsonReadable({ lazy });
    const first = await stream[Symbol.asyncIterator]().next();
    expect(first.done).toBe(false);
    // One 64 KiB batch is at most a few thousand items' worth, far from the whole 100000.
    expect(pulled).toBeLessThan(100000);
    stream.destroy();
  });

  it("lets a failure in the source reach the caller and aborts the response", async () => {
    const lazy = new LazyArray(async function* () {
      yield { i: 1 };
      throw new Error("db went away");
    });
    const res = new PassThrough();
    res.resume();
    await expect(pipeJsonToResponse({ lazy }, res)).rejects.toThrow("db went away");
    expect(res.destroyed).toBe(true);
  });
});
