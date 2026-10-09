/**
 * The v2 template loader (parser-system design §5.3, plan 2026-10-09 P1).
 *
 * Per template: fetch → validate the envelope → check `minAppVersion` → run
 * its own test cases → activate. Anything that fails a step is reported with
 * one of four reasons and stays inactive; nothing here throws into boot.
 *
 * Two rules decide what happens when a NEWER version fails:
 * - a template that was active stays active at its old version (a failed
 *   re-fetch never downgrades good data), and the status says what was
 *   refused;
 * - a template the index no longer names is deactivated and dropped from the
 *   cache — withdrawing a harmful template from the repository must work.
 *
 * State is swapped whole at the end of a sync, so a parse running alongside
 * sees either the old set or the new one, never half of each.
 */
import logger from "../../../../utils/logger";
import type { TemplateCache } from "./cache";
import {
  templateIndexEntrySchema,
  templateIndexSchema,
  validateEnvelope,
  type TemplateEnvelope,
  type TemplateIndexEntry,
} from "./envelope";
import { defaultRunners, runTestCases, type RunnerRegistry } from "./runners";
import type { V2RejectionReason, V2Status, V2TemplateStatusEntry } from "./status";
import { compareVersions, isValidVersion } from "./version";

export type FetchJson = (url: string) => Promise<unknown>;

export interface V2LoaderDeps {
  fetchJson: FetchJson;
  /** Repository raw root, no trailing slash. */
  baseUrl: string;
  /** The running app's version, pre-release suffix stripped. */
  appVersion: string;
  cache: TemplateCache;
  runners?: RunnerRegistry;
}

type Source = "remote" | "cached";

interface ActiveTemplate {
  readonly template: TemplateEnvelope;
  readonly source: Source;
}

type Verdict =
  | { ok: true; template: TemplateEnvelope }
  | { ok: false; reason: V2RejectionReason; detail: string };

interface EntryOutcome {
  readonly status: V2TemplateStatusEntry;
  readonly active?: ActiveTemplate;
}

const MAX_DETAIL_ITEMS = 5;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function activeStatus(active: ActiveTemplate, detail?: string): V2TemplateStatusEntry {
  return {
    id: active.template.id,
    domain: active.template.domain,
    version: active.template.version,
    state: "active",
    source: active.source,
    ...(detail ? { detail } : {}),
  };
}

function rejectedStatus(
  ref: { id: string; domain: string; version: string | null },
  source: Source,
  reason: V2RejectionReason,
  detail: string
): V2TemplateStatusEntry {
  return { ...ref, state: "rejected", source, reason, detail };
}

/** A best-effort label for an index entry or cache file that failed validation. */
function describeRaw(
  raw: unknown,
  fallbackId: string
): { id: string; domain: string; version: string | null } {
  const rec = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    id: typeof rec.id === "string" ? rec.id : fallbackId,
    domain: typeof rec.domain === "string" ? rec.domain : "unknown",
    version: typeof rec.version === "string" ? rec.version : null,
  };
}

export class V2TemplateStore {
  private active: ReadonlyMap<string, ActiveTemplate> = new Map();
  private status: readonly V2TemplateStatusEntry[] = [];
  private indexState: V2Status["index"] = "unknown";
  private readonly runners: RunnerRegistry;

  constructor(private readonly deps: V2LoaderDeps) {
    this.runners = deps.runners ?? defaultRunners;
  }

  getActive(): TemplateEnvelope[] {
    return Array.from(this.active.values(), (a) => a.template);
  }

  getStatus(): V2Status {
    return { index: this.indexState, templates: [...this.status] };
  }

  /** Boot: activate whatever in the disk cache still validates and passes its tests. */
  loadFromCache(): void {
    try {
      const nextActive = new Map<string, ActiveTemplate>();
      const nextStatus = new Map<string, V2TemplateStatusEntry>();
      this.deps.cache.list().forEach((raw, i) => {
        const verdict = this.evaluate(raw);
        if (!verdict.ok) {
          const ref = describeRaw(raw, `cache[${i}]`);
          if (!nextActive.has(ref.id)) {
            nextStatus.set(ref.id, rejectedStatus(ref, "cached", verdict.reason, verdict.detail));
          }
          return;
        }
        const { template } = verdict;
        const existing = nextActive.get(template.id);
        if (existing && compareVersions(existing.template.version, template.version) >= 0) return;
        const active: ActiveTemplate = { template, source: "cached" };
        nextActive.set(template.id, active);
        nextStatus.set(template.id, activeStatus(active));
      });
      this.active = nextActive;
      this.status = Array.from(nextStatus.values());
      logger.info({ active: nextActive.size }, "v2 templates loaded from cache");
    } catch (err) {
      logger.warn({ err }, "v2 template cache could not be read — starting without it");
    }
  }

  /**
   * Fetch the v2 index and every template it names. Returns false when the
   * index is absent or unreadable — the caller then relies on the v1 airline
   * path alone, exactly as before v2 existed. Never rejects.
   */
  async sync(): Promise<boolean> {
    let rawEntries: unknown[];
    try {
      const index = templateIndexSchema.safeParse(
        await this.deps.fetchJson(`${this.deps.baseUrl}/index.json`)
      );
      if (!index.success) {
        this.indexState = "unavailable";
        logger.warn("v2 template index is not a version-2 index — using the v1 path only");
        return false;
      }
      rawEntries = index.data.templates;
    } catch (err) {
      this.indexState = "unavailable";
      logger.info(
        { err: errorMessage(err) },
        "v2 template index unreachable — using the v1 path only"
      );
      return false;
    }

    const nextActive = new Map<string, ActiveTemplate>();
    const nextStatus: V2TemplateStatusEntry[] = [];
    const seen = new Set<string>();
    for (const [i, rawEntry] of rawEntries.entries()) {
      const outcome = await this.syncEntry(rawEntry, i, seen);
      nextStatus.push(outcome.status);
      if (outcome.active) nextActive.set(outcome.active.template.id, outcome.active);
    }

    for (const id of this.active.keys()) {
      if (seen.has(id)) continue;
      this.safeCache(() => this.deps.cache.remove(id), id);
      logger.info({ id }, "v2 template withdrawn from the index — deactivated");
    }

    this.active = nextActive;
    this.status = nextStatus;
    this.indexState = "available";
    const rejected = nextStatus.filter((s) => s.state === "rejected");
    logger.info(
      { active: nextActive.size, rejected: rejected.map((s) => `${s.id}: ${s.reason ?? ""}`) },
      "v2 templates synced"
    );
    return true;
  }

  private async syncEntry(rawEntry: unknown, i: number, seen: Set<string>): Promise<EntryOutcome> {
    const parsed = templateIndexEntrySchema.safeParse(rawEntry);
    if (!parsed.success) {
      const detail = `index entry: ${parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`;
      return {
        status: rejectedStatus(describeRaw(rawEntry, `index[${i}]`), "remote", "invalid", detail),
      };
    }
    const entry = parsed.data;
    if (seen.has(entry.id)) {
      return { status: rejectedStatus(entry, "remote", "invalid", "duplicate id in the index") };
    }
    seen.add(entry.id);

    const current = this.active.get(entry.id);
    if (current && compareVersions(current.template.version, entry.version) >= 0) {
      return { status: activeStatus(current), active: current };
    }

    let raw: unknown;
    try {
      raw = await this.deps.fetchJson(`${this.deps.baseUrl}/${entry.path}`);
    } catch (err) {
      return this.keepOrReject(current, entry, "fetch_failed", errorMessage(err));
    }

    const verdict = this.evaluate(raw, entry);
    if (!verdict.ok) return this.keepOrReject(current, entry, verdict.reason, verdict.detail);

    this.safeCache(() => this.deps.cache.write(verdict.template), entry.id);
    const active: ActiveTemplate = { template: verdict.template, source: "remote" };
    return { status: activeStatus(active), active };
  }

  private keepOrReject(
    current: ActiveTemplate | undefined,
    entry: TemplateIndexEntry,
    reason: V2RejectionReason,
    detail: string
  ): EntryOutcome {
    if (!current) return { status: rejectedStatus(entry, "remote", reason, detail) };
    const note = `version ${entry.version} refused (${reason}: ${detail}); still serving ${current.template.version}`;
    return { status: activeStatus(current, note), active: current };
  }

  /** Validate, version-gate and test one template. `entry` is the index line that named it. */
  private evaluate(raw: unknown, entry?: TemplateIndexEntry): Verdict {
    const validation = validateEnvelope(raw);
    if (!validation.ok) {
      return {
        ok: false,
        reason: "invalid",
        detail: validation.errors.slice(0, MAX_DETAIL_ITEMS).join("; "),
      };
    }
    const { template } = validation;

    if (entry) {
      const mismatch = (["id", "domain", "version"] as const).find((key) =>
        key === "version"
          ? compareVersions(template.version, entry.version) !== 0
          : template[key] !== entry[key]
      );
      if (mismatch) {
        return {
          ok: false,
          reason: "invalid",
          detail: `index says ${mismatch} "${entry[mismatch]}", template says "${template[mismatch]}"`,
        };
      }
    }

    if (template.minAppVersion) {
      const { appVersion } = this.deps;
      if (!isValidVersion(appVersion) || compareVersions(appVersion, template.minAppVersion) < 0) {
        return {
          ok: false,
          reason: "needs_newer_app",
          detail: `needs ${template.minAppVersion}, this instance runs ${appVersion}`,
        };
      }
    }

    const run = runTestCases(template, this.runners);
    if (run.kind === "no_runner") {
      return { ok: false, reason: "invalid", detail: `no runner for domain "${template.domain}"` };
    }
    if (run.kind === "failed") {
      return {
        ok: false,
        reason: "tests_failed",
        detail: run.failures.slice(0, MAX_DETAIL_ITEMS).join("; "),
      };
    }
    return { ok: true, template };
  }

  private safeCache(op: () => void, id: string): void {
    try {
      op();
    } catch (err) {
      logger.warn(
        { id, err },
        "v2 template cache write failed — the template stays in memory only"
      );
    }
  }
}
