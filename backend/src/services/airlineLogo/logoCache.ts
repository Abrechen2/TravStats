import fs from "fs/promises";
import path from "path";
import logger from "../../utils/logger";

export type CachedLogo = { body: Buffer; contentType: string };

const KEY_PATTERN = /^[A-Z0-9][A-Za-z0-9-]{1,30}$/;

export function logoCacheDir(): string {
  // Same dual-path convention as utils/jwtSecret.ts: the prod image mounts
  // a single volume at /app/data; dev uses a repo-local dot-directory.
  return process.env.NODE_ENV === "production"
    ? "/app/data/cache/airline-logos"
    : path.join(process.cwd(), ".travstats-data", "cache", "airline-logos");
}

function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`invalid logo cache key: ${key}`);
}

export async function getCachedLogo(key: string): Promise<CachedLogo | null> {
  assertSafeKey(key);
  try {
    const dir = logoCacheDir();
    const metaRaw = await fs.readFile(path.join(dir, `${key}.meta.json`), "utf-8");
    const meta: unknown = JSON.parse(metaRaw);
    if (typeof meta !== "object" || meta === null || typeof (meta as { contentType?: unknown }).contentType !== "string") {
      return null;
    }
    const body = await fs.readFile(path.join(dir, `${key}.img`));
    return { body, contentType: (meta as { contentType: string }).contentType };
  } catch {
    return null; // cold miss or corrupt entry — treated identically
  }
}

export async function putCachedLogo(key: string, logo: CachedLogo): Promise<void> {
  assertSafeKey(key);
  const dir = logoCacheDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${key}.img`), logo.body);
  await fs.writeFile(
    path.join(dir, `${key}.meta.json`),
    JSON.stringify({ contentType: logo.contentType })
  );
  logger.debug({ operation: "logo_cache_put", key }, "cached airline logo");
}
