import fs from "fs/promises";
import path from "path";
import {
  logoCacheDir,
  getCachedLogoEntry,
  putCachedLogo,
  touchFailedRefresh,
  listCachedLogoKeys,
  isStale,
} from "../logoCache";

const LOGO = { body: Buffer.from("png-bytes"), contentType: "image/png" };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await fs.rm(logoCacheDir(), { recursive: true, force: true });
});

it("stamps fetchedAt, lastAttemptAt and source on write", async () => {
  const before = Date.now();
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  const entry = await getCachedLogoEntry("LH-logo");
  expect(entry?.body).toEqual(LOGO.body);
  expect(entry?.source).toBe("kiwi");
  expect(entry?.fetchedAt).toBeGreaterThanOrEqual(before);
  expect(entry?.lastAttemptAt).toBeGreaterThanOrEqual(before);
});

it("treats a legacy entry with no fetchedAt as infinitely stale", async () => {
  const dir = logoCacheDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "LH-logo.img"), LOGO.body);
  await fs.writeFile(
    path.join(dir, "LH-logo.meta.json"),
    JSON.stringify({ contentType: "image/png" })
  ); // the pre-2.5.0 shape
  const entry = await getCachedLogoEntry("LH-logo");
  expect(entry?.fetchedAt).toBeNull();
  expect(isStale(entry!, 30 * DAY)).toBe(true);
});

it("is fresh inside the max age and stale outside it", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  const entry = (await getCachedLogoEntry("LH-logo"))!;
  expect(isStale(entry, 30 * DAY)).toBe(false);
  expect(isStale({ ...entry, fetchedAt: Date.now() - 31 * DAY }, 30 * DAY)).toBe(true);
});

it("a failed refresh moves lastAttemptAt but NEVER fetchedAt", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  const fresh = (await getCachedLogoEntry("LH-logo"))!;
  // Age the entry so it is genuinely stale, then fail a refresh on it.
  const dir = logoCacheDir();
  const stale = {
    contentType: "image/png",
    fetchedAt: Date.now() - 40 * DAY,
    lastAttemptAt: Date.now() - 40 * DAY,
    source: "kiwi",
  };
  await fs.writeFile(path.join(dir, "LH-logo.meta.json"), JSON.stringify(stale));

  await touchFailedRefresh("LH-logo");

  const after = (await getCachedLogoEntry("LH-logo"))!;
  expect(after.body).toEqual(fresh.body); // bytes survive
  expect(after.fetchedAt).toBe(stale.fetchedAt); // staleness unchanged
  expect(after.lastAttemptAt).toBeGreaterThan(stale.lastAttemptAt!);
  // The whole point: a failing upstream must not make it look fresh.
  expect(isStale(after, 30 * DAY)).toBe(true);
});

it("lists the cached keys", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  await putCachedLogo("BA-icon", LOGO, "vendored");
  expect((await listCachedLogoKeys()).sort()).toEqual(["BA-icon", "LH-logo"]);
});
