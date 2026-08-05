import fs from "fs/promises";
import path from "path";
import { logoCacheDir, putCachedLogo, touchFailedRefresh } from "../../services/airlineLogo/logoCache";
import * as service from "../../services/airlineLogo/airlineLogoService";
import { sweepStaleLogos } from "../airlineLogoRefreshScheduler";

const LOGO = { body: Buffer.from("png-bytes"), contentType: "image/png" };
const DAY = 24 * 60 * 60 * 1000;

/** Rewrites a cached entry's fetchedAt/lastAttemptAt as if it happened `ms` ago. */
async function ageEntry(key: string, ms: number): Promise<void> {
  const dir = logoCacheDir();
  const file = path.join(dir, `${key}.meta.json`);
  const meta: unknown = JSON.parse(await fs.readFile(file, "utf-8"));
  if (typeof meta !== "object" || meta === null) throw new Error(`invalid meta for ${key}`);
  const agedAt = Date.now() - ms;
  await fs.writeFile(file, JSON.stringify({ ...meta, fetchedAt: agedAt, lastAttemptAt: agedAt }));
}

beforeEach(async () => {
  await fs.rm(logoCacheDir(), { recursive: true, force: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it("refreshes only entries past the max age", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi"); // fresh
  await putCachedLogo("BA-logo", LOGO, "kiwi");
  await ageEntry("BA-logo", 40 * DAY); // stale
  const spy = jest.spyOn(service, "refreshLogo").mockResolvedValue(true);

  const result = await sweepStaleLogos();

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("BA-logo");
  expect(result).toEqual({ checked: 2, refreshed: 1 });
});

it("skips a stale entry still inside the retry backoff", async () => {
  await putCachedLogo("BA-logo", LOGO, "kiwi");
  await ageEntry("BA-logo", 40 * DAY);
  await touchFailedRefresh("BA-logo"); // attempted just now -> backoff
  const spy = jest.spyOn(service, "refreshLogo").mockResolvedValue(true);

  const result = await sweepStaleLogos();

  expect(spy).not.toHaveBeenCalled();
  expect(result).toEqual({ checked: 1, refreshed: 0 });
});

it("keeps going when one refresh throws", async () => {
  await putCachedLogo("LH-logo", LOGO, "kiwi");
  await ageEntry("LH-logo", 40 * DAY);
  await putCachedLogo("BA-logo", LOGO, "kiwi");
  await ageEntry("BA-logo", 40 * DAY);
  jest.spyOn(service, "refreshLogo")
    .mockRejectedValueOnce(new Error("upstream down"))
    .mockResolvedValueOnce(true);

  const result = await sweepStaleLogos();

  expect(result.refreshed).toBe(1); // one failed, the sweep completed anyway
});
