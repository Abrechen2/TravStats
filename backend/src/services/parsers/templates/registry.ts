import fs from "fs";
import path from "path";
import https from "https";
import { isValidAirlineTemplate, type AirlineTemplate } from "./types";
import logger from "../../../utils/logger";

const BUILTIN_DIR = path.join(__dirname, "airlines");
const CACHE_DIR = path.join(process.cwd(), ".template-cache");
const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/travstats-community/airline-templates/main/templates";
const INDEX_URL = `${GITHUB_RAW_BASE}/index.json`;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

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

class TemplateRegistry {
  private templates: Map<string, AirlineTemplate> = new Map();
  private templateSources: Map<string, "builtin" | "cached"> = new Map();

  async initialize(): Promise<void> {
    await this.loadBuiltinTemplates();
    await this.loadCachedTemplates();
    this.scheduleSync();
  }

  private async loadBuiltinTemplates(): Promise<void> {
    if (!fs.existsSync(BUILTIN_DIR)) return;
    const files = fs.readdirSync(BUILTIN_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(BUILTIN_DIR, file), "utf-8");
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
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      if (file === "index.json") continue;
      try {
        const raw = fs.readFileSync(path.join(CACHE_DIR, file), "utf-8");
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

  private scheduleSync(): void {
    setTimeout(() => {
      void this.syncFromGitHub();
    }, 5000);
    // Singleton registry — interval runs for process lifetime (intentional)
    setInterval(() => {
      void this.syncFromGitHub();
    }, SYNC_INTERVAL_MS);
  }

  private async syncFromGitHub(): Promise<void> {
    try {
      const index = await this.fetchJson<TemplateIndex>(INDEX_URL);
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

      for (const entry of index.airlines) {
        const existing = this.templates.get(entry.iata);
        if (existing && existing.version >= entry.version) continue;

        const url = `${GITHUB_RAW_BASE}/${entry.iata}.json`;
        const template = await this.fetchJson<unknown>(url);
        if (isValidAirlineTemplate(template)) {
          this.templates.set(template.iata, template);
          this.templateSources.set(template.iata, "cached");
          fs.writeFileSync(
            path.join(CACHE_DIR, `${template.iata}.json`),
            JSON.stringify(template),
          );
        }
      }
      logger.info({ count: index.airlines.length }, "Templates synced from GitHub");
    } catch (err) {
      logger.warn({ err }, "GitHub template sync failed — using cached/builtin templates");
    }
  }

  private fetchJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode ?? "unknown"} from ${url}`));
          res.resume(); // drain the response
          return;
        }
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.setTimeout(10000, () => {
        req.destroy(new Error(`Timeout fetching ${url}`));
      });
      req.on("error", reject);
    });
  }
}

export const templateRegistry = new TemplateRegistry();
