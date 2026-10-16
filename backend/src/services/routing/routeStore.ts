import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import logger from "../../utils/logger";

export const routeKey = (input: unknown): string =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

export function routeDirectory(domain: string): string | null {
  if (process.env.NODE_ENV === "test") return null;
  return path.join(
    process.env.NODE_ENV === "production"
      ? "/app/data"
      : path.join(process.cwd(), ".travstats-data"),
    "routes",
    domain
  );
}

/** Durable successful routes. Only the hot memory set is evicted, never the files.
 * One atomic file per request avoids rewriting or racing a whole library snapshot.
 * Keys are hashes; files contain geometry only, never credentials or journey IDs.
 */
export class RouteStore<T> {
  private readonly memory = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T>>();
  constructor(
    private readonly directory: string | null,
    private readonly parse: (value: unknown) => T | null,
    private readonly maxHot = 500
  ) {}

  private remember(key: string, value: T): void {
    this.memory.delete(key);
    this.memory.set(key, structuredClone(value));
    if (this.memory.size > this.maxHot) this.memory.delete(this.memory.keys().next().value!);
  }

  async get(key: string): Promise<T | null> {
    if (!/^[a-f0-9]{64}$/.test(key)) return null;
    const hot = this.memory.get(key);
    if (hot !== undefined) {
      this.remember(key, hot);
      return structuredClone(hot);
    }
    if (!this.directory) return null;
    try {
      const file = path.join(this.directory, `${key}.json`);
      if ((await fs.stat(file)).size > 16 * 1024 * 1024) return null;
      const value = this.parse(JSON.parse(await fs.readFile(file, "utf8")));
      if (value !== null) this.remember(key, value);
      return value;
    } catch {
      return null;
    }
  }

  async put(key: string, input: T): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(key)) return;
    const value = this.parse(input);
    if (value === null) return;
    this.remember(key, value);
    if (!this.directory) return;
    const temporary = path.join(this.directory, `${key}-${randomUUID()}.tmp`);
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(temporary, path.join(this.directory, `${key}.json`));
    } catch {
      logger.warn({ operation: "route_store_write", reason: "storage_unwritable" });
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  /**
   * Coalesce the read AND computation, including callers arriving during disk I/O.
   * `share` says whether a waiter may take the originator's result: a refusal
   * that belongs to the originator alone (its own spent budget) must not reach
   * a waiter, who then computes once with its own `compute`.
   */
  async resolve(
    key: string,
    compute: () => Promise<T>,
    keep: (value: T) => boolean,
    share: (value: T) => boolean = () => true
  ): Promise<T> {
    let pending = this.pending.get(key);
    const waiter = pending !== undefined;
    if (!pending) {
      pending = (async () => {
        const stored = await this.get(key);
        if (stored !== null) return stored;
        const result = await compute();
        if (keep(result)) await this.put(key, result);
        return result;
      })();
      this.pending.set(key, pending);
    }
    let result: T;
    try {
      result = structuredClone(await pending);
    } finally {
      if (this.pending.get(key) === pending) this.pending.delete(key);
    }
    if (!waiter || share(result)) return result;
    const own = await compute();
    if (keep(own)) await this.put(key, own);
    return own;
  }
}
