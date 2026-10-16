import fs from "fs/promises";
import os from "os";
import path from "path";
import { pruneRouteStore, RouteStore, routeKey } from "../routeStore";
let directory: string;
const parse = (value: unknown): number[] | null =>
  Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v))
    ? value
    : null;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "route-store-test-"));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
it("retains road/sea result objects across process restart and hot-set eviction", async () => {
  const first = new RouteStore(directory, parse, 1);
  const a = routeKey(["road", 1]),
    b = routeKey(["sea", 2]);
  await first.put(a, [1, 2]);
  await first.put(b, [3, 4]);
  const restarted = new RouteStore(directory, parse, 1);
  const compute = jest.fn(async () => [9]);
  expect(await restarted.resolve(a, compute, () => true)).toEqual([1, 2]);
  expect(await restarted.resolve(b, compute, () => true)).toEqual([3, 4]);
  expect(await restarted.resolve(a, compute, () => true)).toEqual([1, 2]);
  expect(compute).not.toHaveBeenCalled();
});
it("keeps independent concurrent writers from replacing each other's routes", async () => {
  const a = routeKey("a"),
    b = routeKey("b");
  await Promise.all([
    new RouteStore(directory, parse).put(a, [1]),
    new RouteStore(directory, parse).put(b, [2]),
  ]);
  const read = new RouteStore(directory, parse);
  expect(await read.get(a)).toEqual([1]);
  expect(await read.get(b)).toEqual([2]);
});
it("retries after a rejected calculation and does not persist negative results", async () => {
  const store = new RouteStore(directory, parse);
  const key = routeKey("failure");
  await expect(
    store.resolve(
      key,
      async () => {
        throw new Error("offline");
      },
      () => true
    )
  ).rejects.toThrow("offline");
  await store.resolve(
    key,
    async () => [],
    (v) => v.length > 0
  );
  const compute = jest.fn(async () => [1]);
  expect(await store.resolve(key, compute, () => true)).toEqual([1]);
  expect(compute).toHaveBeenCalledTimes(1);
});
it("rejects invalid persisted data and unsafe file keys", async () => {
  const store = new RouteStore(directory, parse);
  const key = routeKey("bad");
  await fs.writeFile(path.join(directory, `${key}.json`), '["bad"]');
  expect(await store.get(key)).toBeNull();
  expect(await store.get("../outside")).toBeNull();
});

describe("pruning the durable route files", () => {
  const write = async (name: string, bytes: number, ageDays: number, now: number) => {
    const file = path.join(directory, `${routeKey(name)}.json`);
    await fs.writeFile(file, "x".repeat(bytes));
    const at = new Date(now - ageDays * 86_400_000);
    await fs.utimes(file, at, at);
    return file;
  };
  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false
    );
  // The store grew forever: nothing ever deleted a route file, so routes of
  // deleted trips and routes computed from long-outdated map data stayed.
  it("removes routes older than the age cap and leaves recent ones", async () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const old = await write("old", 10, 200, now);
    const recent = await write("recent", 10, 5, now);
    const result = await pruneRouteStore(directory, {
      now,
      maxAgeMs: 180 * 86_400_000,
      maxBytes: 1_000_000,
    });
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(result.removed).toBe(1);
  });
  it("drops the oldest routes first when the directory is over its size cap", async () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const oldest = await write("a", 400, 30, now);
    const middle = await write("b", 400, 20, now);
    const newest = await write("c", 400, 10, now);
    await pruneRouteStore(directory, { now, maxAgeMs: 365 * 86_400_000, maxBytes: 900 });
    expect(await exists(oldest)).toBe(false);
    expect(await exists(middle)).toBe(true);
    expect(await exists(newest)).toBe(true);
  });
  it("clears temporary files left by an interrupted write and ignores foreign files", async () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const tmp = path.join(directory, `${routeKey("t")}-abc.tmp`);
    await fs.writeFile(tmp, "x");
    const day = new Date(now - 2 * 86_400_000);
    await fs.utimes(tmp, day, day);
    const foreign = path.join(directory, "README.txt");
    await fs.writeFile(foreign, "keep");
    await fs.utimes(foreign, new Date(0), new Date(0));
    await pruneRouteStore(directory, { now, maxAgeMs: 86_400_000, maxBytes: 1_000_000 });
    expect(await exists(tmp)).toBe(false);
    expect(await exists(foreign)).toBe(true);
  });
  it("treats a missing directory as nothing to prune", async () => {
    await expect(
      pruneRouteStore(path.join(directory, "absent"), { maxAgeMs: 1, maxBytes: 1 })
    ).resolves.toEqual({ removed: 0, bytes: 0 });
  });
});
