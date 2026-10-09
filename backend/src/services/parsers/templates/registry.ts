import fs from "fs";
import path from "path";
import { isValidAirlineTemplate, type AirlineTemplate } from "./types";
import logger from "../../../utils/logger";
import { appVersion as runningAppVersion } from "../../../utils/version";
import { fetchJson as httpsFetchJson } from "./fetchJson";
import { createFsTemplateCache } from "./v2/cache";
import { V2TemplateStore, type FetchJson } from "./v2/loader";
import { resolveTemplateRepoBaseUrl } from "./v2/source";
import type { V2Status } from "./v2/status";
import type { TemplateEnvelope } from "./v2/envelope";

const DEFAULT_BUILTIN_DIR = path.join(__dirname, "airlines");
const DEFAULT_CACHE_DIR = path.join(process.cwd(), ".template-cache");
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export interface TemplateRegistryOptions {
  fetchJson?: FetchJson;
  /** Repository raw root; v1 airlines live under `<base>/templates`. */
  baseUrl?: string;
  builtinDir?: string;
  cacheDir?: string;
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

export class TemplateRegistry {
  private templates: Map<string, AirlineTemplate> = new Map();
  private templateSources: Map<string, "builtin" | "cached"> = new Map();
  private readonly fetchJson: FetchJson;
  private readonly v1Base: string;
  private readonly builtinDir: string;
  private readonly cacheDir: string;
  private readonly v2: V2TemplateStore;

  constructor(options: TemplateRegistryOptions = {}) {
    const baseUrl =
      options.baseUrl ?? resolveTemplateRepoBaseUrl(process.env.TEMPLATE_REPO_BASE_URL);
    this.fetchJson = options.fetchJson ?? httpsFetchJson;
    this.v1Base = `${baseUrl}/templates`;
    this.builtinDir = options.builtinDir ?? DEFAULT_BUILTIN_DIR;
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.v2 = new V2TemplateStore({
      fetchJson: this.fetchJson,
      baseUrl,
      appVersion: options.appVersion ?? runningAppVersion,
      cache: createFsTemplateCache(path.join(this.cacheDir, "v2")),
    });
  }

  async initialize(): Promise<void> {
    await this.loadBuiltinTemplates();
    await this.loadCachedTemplates();
    this.v2.loadFromCache();
    this.scheduleSync();
  }

  private async loadBuiltinTemplates(): Promise<void> {
    if (!fs.existsSync(this.builtinDir)) return;
    const files = fs.readdirSync(this.builtinDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(this.builtinDir, file), "utf-8");
        const content: unknown = JSON.parse(raw);
        if (isValidAirlineTemplate(content)) {
          this.templates.set(content.iata, content);
          this.templateSources.set(content.iata, "builtin");
        }
      } catch (err) {
        logger.warn({ file, err }, "Failed to load builtin template");
      }
    }
    logger.info({ count: this.templates.size }, "Builtin templates loaded");
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

  /** v2 templates that validated and passed their own test cases. */
  getActiveV2(): TemplateEnvelope[] {
    return this.v2.getActive();
  }

  getV2Status(): V2Status {
    return this.v2.getStatus();
  }

  /** Trigger an immediate sync and return the new v1 airline template count. */
  async syncNow(): Promise<number> {
    await this.syncFromGitHub();
    return this.templates.size;
  }

  private scheduleSync(): void {
    setTimeout(() => {
      void this.syncFromGitHub();
    }, 5000);
    // Singleton registry — interval runs for process lifetime (intentional)
    setInterval(() => {
      void this.syncFromGitHub();
    }, SYNC_INTERVAL_MS);
  }

  /**
   * v2 first, then the v1 airline index. The v1 sync runs either way: until
   * the airlines move to v2 (plan P4) it is the only flight path, and when the
   * v2 index is absent it is exactly what ran before v2 existed. A v2 failure
   * of any kind is contained here, so it cannot take the v1 sync down with it.
   */
  private async syncFromGitHub(): Promise<void> {
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
      logger.warn({ err }, "GitHub template sync failed — using cached/builtin templates");
    }
  }
}

export const templateRegistry = new TemplateRegistry();
