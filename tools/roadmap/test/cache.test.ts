import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readCache, writeCache, withFallback, type CachedSection } from "../src/cache.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const NOW = new Date("2026-07-13T12:00:00Z");

describe("withFallback", () => {
  it("uses fresh data and reports no staleness", () => {
    const out = withFallback({ ok: true, data: { n: 1 } }, undefined, NOW);
    expect(out.data).toEqual({ n: 1 });
    expect(out.staleSince).toBeNull();
    expect(out.reason).toBeNull();
  });

  it("falls back to the cache and reports WHEN it was collected", () => {
    const out = withFallback(
      { ok: false, reason: "ssh timeout" },
      { data: { n: 7 }, collectedAt: "2026-07-13T09:00:00Z" },
      NOW
    );
    expect(out.data).toEqual({ n: 7 });
    expect(out.staleSince).toBe("2026-07-13T09:00:00Z");
    expect(out.reason).toBe("ssh timeout");
  });

  it("returns null data — never a silent empty — when the collector fails with no cache", () => {
    const out = withFallback({ ok: false, reason: "gh not logged in" }, undefined, NOW);
    expect(out.data).toBeNull();
    expect(out.reason).toBe("gh not logged in");
  });
});

describe("readCache", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `roadmap-cache-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns empty object when file does not exist", async () => {
    const cachePath = join(testDir, "nonexistent.json");
    const result = await readCache(cachePath);
    expect(result).toEqual({});
  });

  it("returns empty object when file is empty", async () => {
    const cachePath = join(testDir, "empty.json");
    await writeCache(cachePath, {});
    // Manually empty it
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, "", "utf8");

    const result = await readCache(cachePath);
    expect(result).toEqual({});
  });

  it("returns empty object when JSON is truncated or corrupt", async () => {
    const cachePath = join(testDir, "corrupt.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, '{"incomplete":', "utf8");

    const result = await readCache(cachePath);
    expect(result).toEqual({});
  });

  it("returns empty object when file contains null", async () => {
    const cachePath = join(testDir, "null.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, "null", "utf8");

    const result = await readCache(cachePath);
    expect(result).toEqual({});
  });

  it("returns empty object when file contains a top-level array (BUG FIX)", async () => {
    const cachePath = join(testDir, "array.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, '["item1", "item2"]', "utf8");

    const result = await readCache(cachePath);
    expect(result).toEqual({});
  });

  it("returns empty object when file contains a bare string", async () => {
    const cachePath = join(testDir, "string.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, '"just a string"', "utf8");

    const result = await readCache(cachePath);
    expect(result).toEqual({});
  });

  it("returns empty object when file contains a number", async () => {
    const cachePath = join(testDir, "number.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, "42", "utf8");

    const result = await readCache(cachePath);
    expect(result).toEqual({});
  });

  it("parses and returns a valid cache file", async () => {
    const cachePath = join(testDir, "valid.json");
    const validCache: Record<string, CachedSection<unknown>> = {
      section1: { data: { value: "test" }, collectedAt: "2026-07-13T10:00:00Z" },
      section2: { data: [1, 2, 3], collectedAt: "2026-07-13T11:00:00Z" },
    };

    await writeCache(cachePath, validCache);
    const result = await readCache(cachePath);
    expect(result).toEqual(validCache);
  });

  it("preserves data in a writeCache → readCache round-trip", async () => {
    const cachePath = join(testDir, "roundtrip.json");
    const originalData: Record<string, CachedSection<unknown>> = {
      github: {
        data: { issues: 42, prs: 7 },
        collectedAt: "2026-07-13T15:30:00Z",
      },
    };

    await writeCache(cachePath, originalData);
    const recovered = await readCache(cachePath);
    expect(recovered).toEqual(originalData);
  });
});

describe("writeCache", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `roadmap-cache-write-test-${Date.now()}-${Math.random()}`);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates parent directories if they do not exist", async () => {
    const cachePath = join(testDir, "nested", "deep", "cache.json");
    const data: Record<string, CachedSection<unknown>> = {
      section: { data: { x: 1 }, collectedAt: "2026-07-13T12:00:00Z" },
    };

    await writeCache(cachePath, data);
    const result = await readCache(cachePath);
    expect(result).toEqual(data);
  });

  it("writes valid JSON with pretty-print formatting", async () => {
    const cachePath = join(testDir, "formatted.json");
    const data: Record<string, CachedSection<unknown>> = {
      test: { data: { key: "value" }, collectedAt: "2026-07-13T12:00:00Z" },
    };

    await writeCache(cachePath, data);
    const { readFile } = await import("node:fs/promises");
    const fileContent = await readFile(cachePath, "utf8");

    expect(fileContent).toContain('"test"');
    expect(fileContent).toContain('"key": "value"');
    expect(fileContent).toContain("\n");
  });
});
