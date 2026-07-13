import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CachedSection, readCache, withFallback, writeCache } from "./cache.js";
import { collectDeployments, type DeploymentState } from "./collectors/deployments.js";
import { collectDiscord, createDiscordFetcher, type DiscordState } from "./collectors/discord.js";
import { collectGit, type GitState } from "./collectors/git.js";
import { collectGithub, type GithubState } from "./collectors/github.js";
import { execRunner } from "./collectors/run.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { buildViewModel } from "./model.js";
import { render } from "./render.js";
import type { CollectorResult } from "./types.js";

// This module lives at <repo-root>/tools/roadmap/src/index.ts. The repo root
// is resolved from the module's own location, not from process.cwd() — the
// tool is meant to be launched with `npm run roadmap` from the repo root
// (see the root package.json), but nothing here should break if it is ever
// invoked directly from inside tools/roadmap.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..", "..", "..");
const CONFIG_PATH = resolve(REPO_ROOT, "roadmap.local.yaml");
const OUT_DIR = resolve(REPO_ROOT, ".roadmap");
const OUT_HTML = resolve(OUT_DIR, "index.html");
const CACHE_PATH = resolve(OUT_DIR, "cache.json");
const DISCORD_ENV = resolve(REPO_ROOT, "tools", "discord-setup", ".env");
const RUN_TIMEOUT_MS = 20_000;

/**
 * `cache.json` is only ever written by `writeCache()` below, keyed by
 * section name, so the value stored under a given key is trusted to match
 * that section's collector output type. `readCache()` can only promise
 * `unknown` at the JSON-parse boundary — this is the single place that
 * trust gets asserted, instead of scattering casts through `main()`.
 */
function cachedSection<T>(
  cache: Record<string, CachedSection<unknown>>,
  key: string
): CachedSection<T> | undefined {
  return cache[key] as CachedSection<T> | undefined;
}

/** A stand-in result for a collector the user explicitly opted out of via a CLI flag. */
function skipped<T>(reason: string): Promise<CollectorResult<T>> {
  return Promise.resolve({ ok: false, reason });
}

function openInBrowser(path: string): void {
  const cmd = process.platform === "win32" ? "cmd" : "open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  // detached + unref: the CLI must exit as soon as its own work is done,
  // never wait on (or get killed together with) the browser process it spawned.
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function readConfigFile(): Promise<string> {
  try {
    return await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `No config found at ${CONFIG_PATH}.\n` +
        "Copy tools/roadmap/roadmap.local.example.yaml to roadmap.local.yaml at the repo root " +
        "and fill in the real instances from CLAUDE.local.md. See tools/roadmap/README.md."
    );
  }
}

async function main(): Promise<void> {
  const skipSsh = process.argv.includes("--no-ssh");
  const skipDiscord = process.argv.includes("--no-discord");

  const config = loadConfig(await readConfigFile());
  const cache = await readCache(CACHE_PATH);
  const run = execRunner(RUN_TIMEOUT_MS);
  const now = new Date();
  const generatedAt = now.toISOString();

  // The Discord client logs in once, lazily, on the first fetch() call, and
  // is reused across every channel. dispose() is safe to call even when
  // fetch() was never invoked (e.g. --no-discord), so it always belongs in
  // a finally — without it the client keeps the event loop alive and the
  // CLI hangs instead of exiting.
  const discordFetcher = createDiscordFetcher(DISCORD_ENV);
  try {
    log("Collecting …");
    const [git, github, deployments, discord] = await Promise.all([
      collectGit(run),
      collectGithub(run),
      skipSsh ? skipped<DeploymentState>("--no-ssh") : collectDeployments(config.instances, run),
      skipDiscord
        ? skipped<DiscordState>("--no-discord")
        : collectDiscord(config.discord, discordFetcher.fetch),
    ]);

    const resolved = {
      git: withFallback(git, cachedSection<GitState>(cache, "git"), now),
      github: withFallback(github, cachedSection<GithubState>(cache, "github"), now),
      deployments: withFallback(
        deployments,
        cachedSection<DeploymentState>(cache, "deployments"),
        now
      ),
      discord: withFallback(discord, cachedSection<DiscordState>(cache, "discord"), now),
    };

    const vm = buildViewModel({ config, generatedAt, ...resolved });

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(OUT_HTML, render(vm), "utf8");

    // Only a successful collection refreshes its slot in the cache — a
    // failed collector (dead SSH hop, missing bot token, --no-ssh,
    // --no-discord) must never overwrite good cached data with an empty
    // result. Untouched slots simply carry over from the previous cache.
    const nextCache: Record<string, CachedSection<unknown>> = { ...cache };
    if (git.ok) nextCache.git = { data: git.data, collectedAt: generatedAt };
    if (github.ok) nextCache.github = { data: github.data, collectedAt: generatedAt };
    if (deployments.ok)
      nextCache.deployments = { data: deployments.data, collectedAt: generatedAt };
    if (discord.ok) nextCache.discord = { data: discord.data, collectedAt: generatedAt };
    await writeCache(CACHE_PATH, nextCache);

    for (const warning of vm.warnings) log(`  ! ${warning}`);
    log(`${vm.decisions.length} decision(s) · ${vm.untriaged.length} untriaged · ${OUT_HTML}`);
    openInBrowser(OUT_HTML);
  } finally {
    await discordFetcher.dispose();
  }
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
