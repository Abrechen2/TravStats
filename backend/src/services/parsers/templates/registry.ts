import fs from "fs";
import path from "path";
import { isValidAirlineTemplate, type AirlineTemplate } from "./types";
import logger from "../../../utils/logger";
import { appVersion as runningAppVersion } from "../../../utils/version";
import { fetchJson as httpsFetchJson } from "./fetchJson";
import { createFsTemplateCache } from "./v2/cache";
import { V2TemplateStore, type FetchJson } from "./v2/loader";
import { effectiveTemplateRepo, type TemplateRepoOrigin } from "./v2/source";
import { prisma } from "../../../db";
import { createDirSnapshot, DEFAULT_SNAPSHOT_DIR } from "./v2/snapshot";
import type { V2Status } from "./v2/status";
import type { TemplateDomain, TemplateEnvelope } from "./v2/envelope";
import { orderByMarket } from "./v2/markets";

const DEFAULT_CACHE_DIR = path.join(process.cwd(), ".template-cache");
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export interface TemplateRegistryOptions {
  fetchJson?: FetchJson;
  /** Repository raw root; v1 airlines live under `<base>/templates`. */
  baseUrl?: string;
  cacheDir?: string;
  /** The bundled v2 templates (`v2/snapshot/`); the lowest-priority v2 source. */
  snapshotDir?: string;
  appVersion?: string;
}

interface TemplateIndex {
  version: string;
  airlines: { iata: string; version: string }[];
}

export interface TemplateStatusEntry {
  iata: string;
  airline: string;
  version: string;
  source: "builtin" | "cached";
}

/**
 * The parser template registry.
 *
 * v2 template files (plan 2026-10-09) are the issuer readers: bundled in the
 * snapshot, cached, and synced from the template repository. Nothing about an
 * issuer is compiled in any more (P4a): the v1 airline templates that used to
 * ship in `airlines/` are v2 files now, or — the HTML-selector ones nobody
 * could prove worked — are read only from the template repository's v1 index
 * and its disk cache, until they have v2 files of their own.
 */
export class TemplateRegistry {
  private templates: Map<string, AirlineTemplate> = new Map();
  private templateSources: Map<string, "builtin" | "cached"> = new Map();
  private readonly fetchJson: FetchJson;
  private v1Base: string;
  private repository: { url: string; origin: TemplateRepoOrigin };
  /** A test or script that names its own repository is never redirected by the admin setting. */
  private readonly fixedRepository: boolean;
  private readonly cacheDir: string;
  private readonly v2: V2TemplateStore;
  private v2LocalLoaded = false;

  constructor(options: TemplateRegistryOptions = {}) {
    this.fixedRepository = options.baseUrl !== undefined;
    this.repository = options.baseUrl
      ? { url: options.baseUrl, origin: "env" }
      : effectiveTemplateRepo(null, undefined);
    const baseUrl = this.repository.url;
    this.fetchJson = options.fetchJson ?? httpsFetchJson;
    this.v1Base = `${baseUrl}/templates`;
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.v2 = new V2TemplateStore({
      fetchJson: this.fetchJson,
      baseUrl,
      appVersion: options.appVersion ?? runningAppVersion,
      cache: createFsTemplateCache(path.join(this.cacheDir, "v2")),
      snapshot: createDirSnapshot(options.snapshotDir ?? DEFAULT_SNAPSHOT_DIR),
    });
  }

  async initialize(): Promise<void> {
    await this.loadAdminRepository();
    await this.loadCachedTemplates();
    this.loadLocalV2();
    this.scheduleSync();
  }

  private async loadCachedTemplates(): Promise<void> {
    if (!fs.existsSync(this.cacheDir)) return;
    const files = fs.readdirSync(this.cacheDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      if (file === "index.json") continue;
      try {
        const raw = fs.readFileSync(path.join(this.cacheDir, file), "utf-8");
        const content: unknown = JSON.parse(raw);
        if (isValidAirlineTemplate(content)) {
          const existing = this.templates.get(content.iata);
          if (!existing || content.version > existing.version) {
            this.templates.set(content.iata, content);
            this.templateSources.set(content.iata, "cached");
          }
        }
      } catch (err) {
        logger.debug({ file, err }, "Skipped malformed cache file");
      }
    }
  }

  /**
   * The admin's repository URL wins over the env var (forgejo#309). Read once
   * at boot; a later change arrives through `useRepository`. A database that
   * cannot be read leaves the env/default repository in place, logged.
   */
  private async loadAdminRepository(): Promise<void> {
    if (this.fixedRepository) return;
    try {
      const row = await prisma.adminSettings.findFirst({
        orderBy: { id: "asc" },
        select: { templateRepoBaseUrl: true },
      });
      this.useRepository(row?.templateRepoBaseUrl ?? null);
    } catch (err) {
      logger.warn({ err }, "Template repository setting unreadable — using the env/default one");
    }
  }

  /**
   * Point every later sync at the repository the admin set (null: the official one). Nothing is fetched here and nothing active
   * changes — the caller syncs, and a failing new repository leaves the last
   * good set serving, exactly as a failing sync always has.
   */
  useRepository(adminUrl: string | null): { url: string; origin: TemplateRepoOrigin } {
    this.repository = effectiveTemplateRepo(adminUrl, undefined);
    this.v1Base = `${this.repository.url}/templates`;
    this.v2.setBaseUrl(this.repository.url);
    return this.repository;
  }

  /** The repository the next sync reads, and which source named it. */
  getRepository(): { url: string; origin: TemplateRepoOrigin } {
    return this.repository;
  }

  getTemplate(iata: string): AirlineTemplate | null {
    return this.templates.get(iata) ?? null;
  }

  getAll(): AirlineTemplate[] {
    return Array.from(this.templates.values());
  }

  getStatus(): TemplateStatusEntry[] {
    return Array.from(this.templates.entries()).map(([iata, t]) => ({
      iata,
      airline: t.airline,
      version: t.version,
      source: this.templateSources.get(iata) ?? "builtin",
    }));
  }

  /**
   * v2 templates that validated and passed their own test cases — optionally of
   * one domain, home-market first when a home country is given (`orderByMarket`:
   * markets order candidates, they never filter them).
   */
  getActiveV2(
    options: { domain?: TemplateDomain; homeCountry?: string | null } = {}
  ): TemplateEnvelope[] {
    // A caller that runs before boot finished (a script, a test) still gets
    // the bundled templates rather than an empty set.
    if (!this.v2LocalLoaded) this.loadLocalV2();
    const all = this.v2.getActive();
    const ofDomain =
      options.domain === undefined ? all : all.filter((t) => t.domain === options.domain);
    return orderByMarket(ofDomain, options.homeCountry);
  }

  /** Load the bundled snapshot and the disk cache, without scheduling any sync. */
  loadLocalV2(): void {
    this.v2LocalLoaded = true;
    this.v2.loadFromCache();
  }

  getV2Status(): V2Status {
    return this.v2.getStatus();
  }

  /** Trigger an immediate sync and return the new v1 airline template count. */
  async syncNow(): Promise<number> {
    await this.syncFromGitHub();
    return this.templates.size;
  }

  /**
   * "Off means off" (forgejo#392): the scheduled sync is a background call out,
   * so the admin's update/templates switch stops it. A manual `syncNow()` is an
   * explicit request and still runs.
   */
  private async scheduledSync(): Promise<void> {
    try {
      const row = await prisma.adminSettings.findFirst({
        orderBy: { id: "asc" },
        select: { updateCheckEnabled: true },
      });
      if (row && !row.updateCheckEnabled) {
        logger.debug("template sync skipped: update checks are switched off");
        return;
      }
    } catch (err) {
      // Fail closed: with the switch unreadable this attempt makes no call out;
      // the next interval tries again.
      logger.warn({ err }, "update-check switch unreadable — template sync skipped this round");
      return;
    }
    await this.syncFromGitHub();
  }

  private scheduleSync(): void {
    setTimeout(() => {
      void this.scheduledSync();
    }, 5000);
    // Singleton registry — interval runs for process lifetime (intentional)
    setInterval(() => {
      void this.scheduledSync();
    }, SYNC_INTERVAL_MS);
  }

  /**
   * v2 first, then the v1 airline index. The v1 sync runs either way: until
   * the airlines move to v2 (plan P4) it is the only flight path, and when the
   * v2 index is absent it is exactly what ran before v2 existed. A v2 failure
   * of any kind is contained here, so it cannot take the v1 sync down with it.
   */
  private async syncFromGitHub(): Promise<void> {
    // A sync refines what boot loaded; loading the local sources AFTER it
    // would throw its result away.
    if (!this.v2LocalLoaded) this.loadLocalV2();
    try {
      await this.v2.sync();
    } catch (err) {
      logger.warn({ err }, "v2 template sync failed — v1 airline templates unaffected");
    }
    await this.syncV1();
  }

  private async syncV1(): Promise<void> {
    try {
      const index = (await this.fetchJson(`${this.v1Base}/index.json`)) as TemplateIndex;
      if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });

      for (const entry of index.airlines) {
        const existing = this.templates.get(entry.iata);
        if (existing && existing.version >= entry.version) continue;

        const url = `${this.v1Base}/${entry.iata}.json`;
        const template = await this.fetchJson(url);
        if (isValidAirlineTemplate(template)) {
          this.templates.set(template.iata, template);
          this.templateSources.set(template.iata, "cached");
          fs.writeFileSync(
            path.join(this.cacheDir, `${template.iata}.json`),
            JSON.stringify(template)
          );
        }
      }
      logger.info({ count: index.airlines.length }, "Templates synced from GitHub");
    } catch (err) {
      logger.warn({ err }, "GitHub template sync failed — using cached templates");
    }
  }
}

export const templateRegistry = new TemplateRegistry();
