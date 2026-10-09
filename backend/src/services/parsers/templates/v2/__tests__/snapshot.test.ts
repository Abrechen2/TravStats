import { describe, it, expect, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { createMemoryTemplateCache } from "../cache";
import type { TemplateEnvelope } from "../envelope";
import { V2TemplateStore } from "../loader";
import {
  createDirSnapshot,
  createMemorySnapshot,
  DEFAULT_SNAPSHOT_DIR,
  type SnapshotEntry,
} from "../snapshot";
import { syncSnapshot, validateRepository } from "../snapshotSync";
import { validTemplate } from "./fixtures";

/**
 * The bundled snapshot (plan 2026-10-09 P4a): the lowest-priority v2 source,
 * so a fresh or offline instance still reads every issuer — and, like every
 * other source, active only after validation and its own test cases.
 */
const BASE = "https://templates.example.test/main";

function entryFor(t: TemplateEnvelope): SnapshotEntry {
  return {
    entry: {
      id: t.id,
      domain: t.domain,
      version: t.version,
      path: `${t.domain}/${t.id.split(":")[1]}.json`,
    },
    raw: t,
    label: t.id,
  };
}

function store(snapshot: SnapshotEntry[], cached: unknown[] = [], fetchJson = offline) {
  return new V2TemplateStore({
    fetchJson,
    baseUrl: BASE,
    appVersion: "2.7.0",
    cache: createMemoryTemplateCache(cached),
    snapshot: createMemorySnapshot(snapshot),
  });
}

function offline(): Promise<unknown> {
  return Promise.reject(new Error("offline"));
}

describe("the bundled snapshot as a v2 source", () => {
  it("activates a snapshot template that passes its own tests, and says where it came from", () => {
    const s = store([entryFor(validTemplate())]);
    s.loadFromCache();
    expect(s.getActive().map((t) => t.id)).toEqual(["lodging:examplechain"]);
    expect(s.getStatus().templates[0]).toMatchObject({ state: "active", source: "snapshot" });
  });

  it("refuses a snapshot template that fails its tests — bundling earns no trust", () => {
    const broken = validTemplate({ match: { markers: ["nobody"], anchors: ["nothing"] } });
    const s = store([entryFor(broken)]);
    s.loadFromCache();
    expect(s.getActive()).toEqual([]);
    expect(s.getStatus().templates[0]).toMatchObject({
      state: "rejected",
      source: "snapshot",
      reason: "tests_failed",
    });
  });

  it("refuses a file whose id or version disagrees with the snapshot index", () => {
    const t = validTemplate();
    const lying: SnapshotEntry = {
      ...entryFor(t),
      entry: { ...entryFor(t).entry!, version: "9.9.9" },
    };
    const s = store([lying]);
    s.loadFromCache();
    expect(s.getStatus().templates[0]).toMatchObject({ state: "rejected", reason: "invalid" });
  });

  it("lets the cache win at an equal or higher version, and the snapshot win over an older cache", () => {
    const snap = validTemplate({ version: "2026.10.02" });
    const sameInCache = store([entryFor(snap)], [validTemplate({ version: "2026.10.02" })]);
    sameInCache.loadFromCache();
    expect(sameInCache.getStatus().templates[0].source).toBe("cached");

    const olderInCache = store([entryFor(snap)], [validTemplate({ version: "2026.10.01" })]);
    olderInCache.loadFromCache();
    expect(olderInCache.getStatus().templates[0]).toMatchObject({
      source: "snapshot",
      version: "2026.10.02",
    });
  });

  it("keeps the snapshot's order when the cache replaces one of its templates", () => {
    const a = validTemplate({ id: "lodging:zeta" });
    const b = validTemplate({ id: "lodging:alpha" });
    const s = store([entryFor(a), entryFor(b)], [validTemplate({ id: "lodging:alpha" })]);
    s.loadFromCache();
    expect(s.getActive().map((t) => t.id)).toEqual(["lodging:zeta", "lodging:alpha"]);
  });

  it("keeps serving the snapshot when the remote index is unreachable", async () => {
    const s = store([entryFor(validTemplate())]);
    s.loadFromCache();
    expect(await s.sync()).toBe(false);
    expect(s.getActive()).toHaveLength(1);
  });

  it("ships a snapshot in which every template is active", () => {
    const s = new V2TemplateStore({
      fetchJson: offline,
      baseUrl: BASE,
      appVersion: "99.0.0",
      cache: createMemoryTemplateCache(),
      snapshot: createDirSnapshot(DEFAULT_SNAPSHOT_DIR),
    });
    s.loadFromCache();
    const status = s.getStatus().templates;
    expect(status.length).toBeGreaterThan(0);
    expect(status.filter((t) => t.state !== "active")).toEqual([]);
  });

  it("reads a missing directory as an empty snapshot", () => {
    expect(createDirSnapshot(path.join(os.tmpdir(), "no-such-snapshot-dir")).list()).toEqual([]);
  });
});

describe("syncSnapshot", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-snap-"));
    dirs.push(d);
    return d;
  }
  function writeRepo(dir: string, templates: TemplateEnvelope[]): void {
    const entries = templates.map((t) => entryFor(t).entry!);
    fs.writeFileSync(
      path.join(dir, "index.json"),
      JSON.stringify({ version: 2, templates: entries })
    );
    for (const [i, t] of templates.entries()) {
      fs.mkdirSync(path.join(dir, t.domain), { recursive: true });
      fs.writeFileSync(path.join(dir, entries[i].path), JSON.stringify(t));
    }
  }

  it("copies every template the index names and removes what it no longer names", () => {
    const from = tmp();
    const to = tmp();
    writeRepo(from, [validTemplate()]);
    fs.mkdirSync(path.join(to, "lodging"));
    fs.writeFileSync(path.join(to, "lodging", "withdrawn.json"), "{}");
    const report = syncSnapshot(from, to);
    expect(report).toEqual({
      copied: ["lodging/examplechain.json"],
      removed: ["lodging/withdrawn.json"],
      failures: [],
    });
    expect(fs.readFileSync(path.join(to, "lodging/examplechain.json"), "utf-8")).toBe(
      fs.readFileSync(path.join(from, "lodging/examplechain.json"), "utf-8")
    );
    expect(createDirSnapshot(to).list()).toHaveLength(1);
  });

  it("writes nothing when one template fails its own tests", () => {
    const from = tmp();
    const to = tmp();
    writeRepo(from, [
      validTemplate(),
      validTemplate({
        id: "lodging:broken",
        match: { markers: ["nobody"], anchors: ["nothing"] },
      }),
    ]);
    const report = syncSnapshot(from, to);
    expect(report.copied).toEqual([]);
    expect(report.failures.join("\n")).toMatch(/lodging:broken/);
    expect(fs.readdirSync(to)).toEqual([]);
  });

  // The template repository's CI (`scripts/validate.mjs` there, this app's
  // `scripts/validate-template-repo.ts` here) checks a clone without a sync.
  it("validateRepository names an unindexed file and a version out of step, and writes nothing", () => {
    const from = tmp();
    writeRepo(from, [validTemplate()]);
    fs.writeFileSync(path.join(from, "lodging", "stray.json"), "{}");
    expect(validateRepository(from)).toMatchObject({
      failures: [],
      unindexed: ["lodging/stray.json"],
    });
    const index = JSON.parse(fs.readFileSync(path.join(from, "index.json"), "utf-8"));
    index.templates[0].version = "2099.1.1";
    fs.writeFileSync(path.join(from, "index.json"), JSON.stringify(index));
    expect(validateRepository(from).failures.join("\n")).toMatch(/index says 2099\.1\.1/);
  });

  it("validateRepository reports an unreadable index instead of throwing", () => {
    expect(validateRepository(tmp()).failures[0]).toMatch(/unreadable/);
  });
});
