import fs from "fs/promises";
import os from "os";
import path from "path";
import { RailRouteCache, railRouteCacheKey } from "../railRouteCache";
import type { LonLat } from "../railGeometryMath";

const line: LonLat[] = [
  [8.663785, 50.107149],
  [8.67, 50.11],
];
const key = railRouteCacheKey("https://routing.test", "all_tracks", line);
let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "rail-route-test-"));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  jest.restoreAllMocks();
});

it("reuses a route after a process restart without exposing mutable cache state", async () => {
  const cache = new RailRouteCache(directory);
  await cache.put(key, line);
  const restarted = new RailRouteCache(directory);
  expect(await restarted.get(key)).toEqual(line);
  const copy = await restarted.get(key);
  copy![0][0] = 0;
  expect(await restarted.get(key)).toEqual(line);
});
it("expires routes after thirty days", async () => {
  await new RailRouteCache(directory).put(key, line);
  const later = Date.now() + 31 * 86400_000;
  jest.spyOn(Date, "now").mockReturnValue(later);
  expect(await new RailRouteCache(directory).get(key)).toBeNull();
});
it("keys direction, intermediate stops, profile and provider separately", () => {
  const variants = [
    railRouteCacheKey("https://other.test", "all_tracks", line),
    railRouteCacheKey("https://routing.test", "other", line),
    railRouteCacheKey("https://routing.test", "all_tracks", [...line].reverse()),
    railRouteCacheKey("https://routing.test", "all_tracks", [line[0], [8.668, 50.115], line[1]]),
  ];
  expect(new Set([key, ...variants]).size).toBe(5);
  expect(railRouteCacheKey("https://routing.test/", "all_tracks", line)).toBe(key);
});
it("treats corrupt disk content as a cache miss", async () => {
  await fs.writeFile(path.join(directory, "routes.json"), "broken");
  expect(await new RailRouteCache(directory).get(key)).toBeNull();
});
it("keeps a successful route usable when disk storage is unwritable", async () => {
  const file = path.join(directory, "not-a-directory");
  await fs.writeFile(file, "occupied");
  const cache = new RailRouteCache(file);
  await expect(cache.put(key, line)).resolves.toBeUndefined();
  expect(await cache.get(key)).toEqual(line);
});
it("bounds the number of stored routes", async () => {
  const cache = new RailRouteCache(directory);
  for (let i = 0; i < 501; i++)
    await cache.put(railRouteCacheKey("https://routing.test", String(i), line), line);
  expect(await cache.get(railRouteCacheKey("https://routing.test", "0", line))).toBeNull();
  expect(await cache.get(railRouteCacheKey("https://routing.test", "500", line))).toEqual(line);
});
