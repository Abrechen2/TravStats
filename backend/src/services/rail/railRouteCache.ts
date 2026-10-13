import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import logger from "../../utils/logger";
import { isTracedShape, type LonLat } from "./railGeometryMath";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_POINTS = 200_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const entrySchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  expires: z.number().finite(),
  line: z
    .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
    .min(2)
    .max(MAX_POINTS),
});
type Entry = z.infer<typeof entrySchema>;

/** Versioned: a changed routing policy must not reuse the old policy's answer. */
export function railRouteCacheKey(
  baseUrl: string,
  profile: string,
  points: readonly LonLat[]
): string {
  return createHash("sha256")
    .update(JSON.stringify([1, baseUrl.replace(/\/+$/, ""), profile, points]))
    .digest("hex");
}

/** Bounded, regenerable cache on the same data volume as the logo cache. No account identifiers or timetable data. */
export class RailRouteCache {
  private entries = new Map<string, Entry>();
  private loaded: Promise<void> | null = null;
  private writing = Promise.resolve();

  constructor(private readonly directory: string) {}

  private async load(): Promise<void> {
    if (!this.loaded)
      this.loaded = (async () => {
        try {
          const file = path.join(this.directory, "routes.json");
          if ((await fs.stat(file)).size > MAX_FILE_BYTES) return;
          const parsed = z
            .array(entrySchema)
            .max(MAX_ENTRIES)
            .safeParse(JSON.parse(await fs.readFile(file, "utf8")));
          if (parsed.success) {
            for (const entry of parsed.data) {
              if (entry.expires > Date.now() && isTracedShape(entry.line))
                this.entries.set(entry.key, entry);
            }
            this.trim();
          }
        } catch {
          // A missing/corrupt cache is a miss, never a failed journey save.
        }
      })();
    await this.loaded;
  }

  private trim(): void {
    for (const [key, entry] of this.entries)
      if (entry.expires <= Date.now()) this.entries.delete(key);
    let points = [...this.entries.values()].reduce((sum, entry) => sum + entry.line.length, 0);
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= MAX_ENTRIES && points <= MAX_POINTS) break;
      points -= entry.line.length;
      this.entries.delete(key);
    }
  }

  async get(key: string): Promise<LonLat[] | null> {
    await this.load();
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= Date.now()) return null;
    return structuredClone(entry.line);
  }

  async put(key: string, line: LonLat[]): Promise<void> {
    await this.load();
    const entry = entrySchema.safeParse({ key, line, expires: Date.now() + TTL_MS });
    if (!entry.success || !isTracedShape(line)) return;
    this.entries.delete(key);
    this.entries.set(key, entry.data);
    this.trim();
    this.writing = this.writing.then(async () => {
      const temporary = path.join(this.directory, `routes-${randomUUID()}.tmp`);
      try {
        await fs.mkdir(this.directory, { recursive: true });
        await fs.writeFile(temporary, JSON.stringify([...this.entries.values()]), { mode: 0o600 });
        await fs.rename(temporary, path.join(this.directory, "routes.json"));
      } catch {
        logger.warn({ operation: "rail_route_cache_write", reason: "cache_unwritable" });
      } finally {
        await fs.unlink(temporary).catch(() => undefined);
      }
    });
    await this.writing;
  }
}

export const railRouteCache = new RailRouteCache(
  path.join(
    process.env.NODE_ENV === "production"
      ? "/app/data"
      : path.join(process.cwd(), ".travstats-data"),
    "cache",
    "rail-routes"
  )
);
