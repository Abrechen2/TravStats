import fs from "fs/promises";
import os from "os";
import path from "path";
import { RouteStore, routeKey } from "../routeStore";
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
