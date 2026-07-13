# Internal Roadmap Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-run Node tool that generates one self-contained HTML page joining GitHub issues, Discord feedback, the git branch/worktree layout and the images actually running on the deployment targets — so the pending decisions are visible instead of implicit.

**Architecture:** Three isolated stages. Collectors (`src/collectors/*.ts`) each read one source and return `{ok, data} | {ok:false, reason}` — they never throw. `buildViewModel` (`src/model.ts`) is a pure function merging the curated YAML layer with the live layer. `render` (`src/render.ts`) is a pure function turning the view model into HTML. `src/index.ts` wires them. Because the two pure functions carry all the judgement, they carry all the tests; the collectors are thin and take an injected runner so they test without a network.

**Tech Stack:** TypeScript (ESM, `strict`), `tsx` runner, `vitest`, `yaml`, `zod`, `discord.js` (reusing the existing bot credentials). Mirrors `tools/discord-setup/` exactly.

**Spec:** `docs/superpowers/specs/2026-07-13-internal-roadmap-board-design.md`

## Global Constraints

- **`any` is forbidden.** Use `unknown` + type guards. (`CLAUDE.md`)
- **No `console.log` in shipped app code.** This tool is a CLI, so a single `src/log.ts` wrapping `process.stdout.write` is the only output path — mirroring `tools/discord-setup/src/log.ts`.
- **All code, comments and commits in English.** (Language policy.)
- **File size:** 200–400 lines ideal, 800 hard maximum.
- **Immutability:** spread, never mutate in place.
- **No secrets, hosts, IPs, CT numbers or container names in committed code.** They live in the gitignored `roadmap.local.yaml`. The repo is public.
- **Async:** always `async/await`, never `.then()`.
- **Prettier:** printWidth 100, `singleQuote: false`.

---

### Task 1: Scaffold the tool and prove the two gitignore traps

The repo ignores `tools/*` wholesale (only `tools/discord-setup/` is whitelisted) and ignores `*.md` with a whitelist. A new tool directory would therefore be **invisible to git**, and a new `.yaml` data file would **not** be ignored and would be published to the public repo. Both must be proven, not assumed.

**Files:**
- Create: `tools/roadmap/package.json`
- Create: `tools/roadmap/tsconfig.json`
- Create: `tools/roadmap/.gitignore`
- Create: `tools/roadmap/src/log.ts`
- Create: `tools/roadmap/roadmap.local.example.yaml`
- Modify: `.gitignore` (add the two entries)
- Modify: `package.json` (root — add the `roadmap` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `log(message: string): void` from `src/log.ts`, used by every later task.

- [ ] **Step 1: Create the package manifest**

`tools/roadmap/package.json`:

```json
{
  "name": "travstats-roadmap",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Internal roadmap board generator — joins git, GitHub, Discord and the live deployments into one page",
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "discord.js": "^14.26.0",
    "dotenv": "^16.4.5",
    "yaml": "^2.6.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create the TypeScript config**

`tools/roadmap/tsconfig.json` (identical to `tools/discord-setup/tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create the tool-local gitignore**

`tools/roadmap/.gitignore` — the generated page and the collector cache never get committed:

```gitignore
node_modules/
.roadmap/
```

- [ ] **Step 4: Create the log module**

`tools/roadmap/src/log.ts`:

```typescript
/**
 * The single output path for this CLI. Everything else in the tool returns
 * values; only the entry point and the collectors' progress notes print.
 */
export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}
```

- [ ] **Step 5: Create the example config**

`tools/roadmap/roadmap.local.example.yaml` — this file IS committed (it is the schema documentation); the real `roadmap.local.yaml` at the repo root is not. Host values are placeholders; the real ones come from `CLAUDE.local.md`.

```yaml
# Copy to <repo-root>/roadmap.local.yaml and fill in from CLAUDE.local.md.
# That file is gitignored. This one is not — never put real hosts here.

instances:
  - id: prod
    label: Prod
    role: production
    node: 192.0.2.1 # placeholder — see CLAUDE.local.md
    ct: 100
    container: TravStats
    expect: "2.3.1" # the version the roadmap believes runs here

discord:
  - channel: dev-talk
    triagedUpTo: "2026-07-12T16:42:30Z"

versions:
  - id: "2.4.0"
    state: rc # released | rc | awaiting-merge | planned
    branch: main
    note: |
      Markdown. Rendered in the version's detail panel.

items:
  # A github item carries NO title — it is read live from the issue number.
  - id: gh-197
    source: { type: github, ref: 197 }
    version: "2.4.0"
    status: fixed-awaiting-release
    branch: main
    notes: |
      Markdown. Long-form context lives here.

  # Non-github items have no live anchor, so they carry a title.
  - id: discord-lodging-fx
    source: { type: discord, url: "https://discord.com/channels/..." }
    title: "Detail page converts EUR to EUR and prints an ECB rate"
    version: "2.6.0"
    status: planned
```

- [ ] **Step 6: Whitelist the tool and ignore the data**

Modify `.gitignore`. Add `!tools/roadmap/` directly below the existing `!tools/discord-setup/` line:

```gitignore
# Committed, non-scratch tools (real deliverables, tracked normally):
!tools/discord-setup/
!tools/roadmap/
```

And append a new block at the end of the file:

```gitignore
# Internal roadmap board — the curated data layer and the generated page.
# The *.md rule above does NOT cover .yaml, so this must be explicit:
# without it the internal roadmap would be published to the public repo.
roadmap.local.yaml
.roadmap/
```

- [ ] **Step 7: Prove both traps**

Run:

```bash
git check-ignore -v roadmap.local.yaml .roadmap/index.html
```

Expected: two lines, each naming `.gitignore` and the matching rule. **Non-empty output means ignored — that is what we want here.**

Run:

```bash
git check-ignore -v tools/roadmap/package.json; echo "exit=$?"
```

Expected: **no output, `exit=1`** — the tool itself is NOT ignored. If this prints a match, the `!tools/roadmap/` whitelist is missing or in the wrong order and the tool would silently never be committed.

- [ ] **Step 8: Add the root script**

Modify the root `package.json`, adding to `scripts`:

```json
"roadmap": "cd tools/roadmap && npm run start"
```

- [ ] **Step 9: Install and verify the toolchain**

Run:

```bash
cd tools/roadmap && npm install && npx tsc --noEmit
```

Expected: install succeeds, `tsc` exits 0 with no output.

- [ ] **Step 10: Commit**

```bash
git add .gitignore package.json tools/roadmap
git commit -m "feat(roadmap): scaffold the roadmap board tool

tools/* is ignored wholesale and *.md does not cover .yaml — so the tool
needs an explicit whitelist to be tracked at all, and the curated data file
needs an explicit ignore or the internal roadmap lands in the public repo.
Both proven with git check-ignore."
```

---

### Task 2: Domain types and the validating YAML loader

The loader is where the anti-drift rule is enforced: a `github` item may not carry a hand-written title, because the title is live data and a transcribed copy is exactly the drift this tool exists to prevent.

**Files:**
- Create: `tools/roadmap/src/types.ts`
- Create: `tools/roadmap/src/config.ts`
- Test: `tools/roadmap/test/config.test.ts`

**Interfaces:**
- Consumes: `log` from Task 1.
- Produces:
  - All domain types (below) — every later task imports from `src/types.ts`.
  - `loadConfig(yamlText: string): RoadmapConfig` — throws `Error` with a human-readable message on invalid input.

- [ ] **Step 1: Write the domain types**

`tools/roadmap/src/types.ts`:

```typescript
/** A collector never throws; it reports a typed failure so one dead source
 *  cannot cost the whole page. */
export type CollectorResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export type ItemStatus =
  | "planned"
  | "active"
  | "blocked"
  | "parked"
  | "fixed-awaiting-release"
  | "done";

export type SourceType = "github" | "discord" | "audit" | "owner";

export type VersionState = "released" | "rc" | "awaiting-merge" | "planned";

export interface ItemSource {
  readonly type: SourceType;
  /** GitHub issue number. Present only when type === "github". */
  readonly ref?: number;
  /** Jump link for a discord source. */
  readonly url?: string;
}

export interface RoadmapItem {
  readonly id: string;
  readonly source: ItemSource;
  /** Required for every source EXCEPT github, whose title is read live. */
  readonly title?: string;
  /** A version id, or "backlog". */
  readonly version: string;
  readonly status: ItemStatus;
  readonly branch?: string;
  readonly notes?: string;
}

export interface RoadmapVersion {
  readonly id: string;
  readonly state: VersionState;
  readonly branch?: string;
  readonly note?: string;
}

export interface InstanceDef {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly node: string;
  readonly ct: number;
  readonly container: string;
  /** The version the roadmap believes runs here; a mismatch is surfaced. */
  readonly expect?: string;
}

export interface DiscordWatermark {
  readonly channel: string;
  readonly triagedUpTo: string;
}

export interface RoadmapConfig {
  readonly instances: readonly InstanceDef[];
  readonly versions: readonly RoadmapVersion[];
  readonly items: readonly RoadmapItem[];
  readonly discord: readonly DiscordWatermark[];
}

/** The synthetic column id for open issues that no item claims. */
export const UNASSIGNED = "unassigned";
/** The synthetic column id for items with no target version. */
export const BACKLOG = "backlog";
```

- [ ] **Step 2: Write the failing tests**

`tools/roadmap/test/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const VALID = `
instances:
  - id: prod
    label: Prod
    role: production
    node: 192.0.2.1
    ct: 100
    container: TravStats
discord:
  - channel: dev-talk
    triagedUpTo: "2026-07-12T16:42:30Z"
versions:
  - id: "2.4.0"
    state: rc
    branch: main
items:
  - id: gh-197
    source: { type: github, ref: 197 }
    version: "2.4.0"
    status: fixed-awaiting-release
`;

describe("loadConfig", () => {
  it("parses a valid config", () => {
    const config = loadConfig(VALID);
    expect(config.items[0].id).toBe("gh-197");
    expect(config.versions[0].state).toBe("rc");
    expect(config.instances[0].ct).toBe(100);
  });

  it("rejects a github item that carries a hand-written title", () => {
    const yaml = VALID.replace(
      "    status: fixed-awaiting-release",
      '    status: fixed-awaiting-release\n    title: "Booking number missing"'
    );
    expect(() => loadConfig(yaml)).toThrow(/title/i);
  });

  it("requires a title on a non-github item", () => {
    const yaml = `${VALID}
  - id: discord-nav
    source: { type: discord }
    version: "2.4.0"
    status: planned
`;
    expect(() => loadConfig(yaml)).toThrow(/title/i);
  });

  it("rejects an unknown status", () => {
    const yaml = VALID.replace("status: fixed-awaiting-release", "status: nearly-done");
    expect(() => loadConfig(yaml)).toThrow(/status/i);
  });

  it("rejects an item pointing at a version that does not exist", () => {
    const yaml = VALID.replace('version: "2.4.0"\n    status', 'version: "9.9.9"\n    status');
    expect(() => loadConfig(yaml)).toThrow(/9\.9\.9/);
  });

  it("accepts an item in the backlog column without a declared version", () => {
    const yaml = VALID.replace('version: "2.4.0"\n    status', "version: backlog\n    status");
    expect(loadConfig(yaml).items[0].version).toBe("backlog");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/config.test.ts`
Expected: FAIL — `Failed to resolve import "../src/config.js"`.

- [ ] **Step 4: Implement the loader**

`tools/roadmap/src/config.ts`:

```typescript
import { parse } from "yaml";
import { z } from "zod";
import { BACKLOG, type RoadmapConfig } from "./types.js";

const sourceSchema = z.object({
  type: z.enum(["github", "discord", "audit", "owner"]),
  ref: z.number().int().positive().optional(),
  url: z.string().url().optional(),
});

const itemSchema = z
  .object({
    id: z.string().min(1),
    source: sourceSchema,
    title: z.string().min(1).optional(),
    version: z.string().min(1),
    status: z.enum(["planned", "active", "blocked", "parked", "fixed-awaiting-release", "done"]),
    branch: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((item, ctx) => {
    // The whole point of the two-layer design: a github item's title is LIVE.
    // A transcribed copy is the drift this tool exists to prevent, so refuse it.
    if (item.source.type === "github") {
      if (item.title !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `item "${item.id}": a github item must not carry a title — it is read live from issue #${item.source.ref ?? "?"}`,
        });
      }
      if (item.source.ref === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `item "${item.id}": a github source needs a "ref" (the issue number)`,
        });
      }
    } else if (item.title === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `item "${item.id}": a ${item.source.type} item has no live anchor and therefore needs a title`,
      });
    }
  });

const configSchema = z.object({
  instances: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        role: z.string().min(1),
        node: z.string().min(1),
        ct: z.number().int().positive(),
        container: z.string().min(1),
        expect: z.string().optional(),
      })
    )
    .default([]),
  discord: z
    .array(z.object({ channel: z.string().min(1), triagedUpTo: z.string().datetime() }))
    .default([]),
  versions: z
    .array(
      z.object({
        id: z.string().min(1),
        state: z.enum(["released", "rc", "awaiting-merge", "planned"]),
        branch: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .default([]),
  items: z.array(itemSchema).default([]),
});

/**
 * Parse and validate the curated layer. Throws with a readable message rather
 * than returning a partial config — a half-understood roadmap is worse than no
 * page at all, because it looks complete.
 */
export function loadConfig(yamlText: string): RoadmapConfig {
  const parsed = configSchema.safeParse(parse(yamlText));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`roadmap.local.yaml is invalid:\n${detail.join("\n")}`);
  }

  const known = new Set([...parsed.data.versions.map((v) => v.id), BACKLOG]);
  const orphan = parsed.data.items.find((item) => !known.has(item.version));
  if (orphan) {
    throw new Error(
      `roadmap.local.yaml is invalid:\n  - item "${orphan.id}": version "${orphan.version}" is not declared under versions:`
    );
  }

  return parsed.data;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/config.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/roadmap/src/types.ts tools/roadmap/src/config.ts tools/roadmap/test/config.test.ts
git commit -m "feat(roadmap): domain types and the validating config loader

The loader refuses a github item that carries a hand-written title. That
transcription is exactly the drift the two-layer design exists to prevent —
the airline catalogue drifted the same way, silently, for weeks."
```

---

### Task 3: The git collector

**Files:**
- Create: `tools/roadmap/src/collectors/run.ts`
- Create: `tools/roadmap/src/collectors/git.ts`
- Test: `tools/roadmap/test/git.test.ts`

**Interfaces:**
- Consumes: `CollectorResult` from `src/types.ts`.
- Produces:
  - `type Runner = (cmd: string, args: readonly string[]) => Promise<string>` (from `run.ts`), plus the real `execRunner`. Every collector takes a `Runner` so it tests without a network.
  - `collectGit(run: Runner): Promise<CollectorResult<GitState>>`
  - `interface GitBranch { name: string; head: string; ahead: number; worktree: string | null }`
  - `interface GitState { branches: GitBranch[] }`

- [ ] **Step 1: Write the runner**

`tools/roadmap/src/collectors/run.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Injected into every collector so tests never touch the network or the disk. */
export type Runner = (cmd: string, args: readonly string[]) => Promise<string>;

export function execRunner(timeoutMs: number): Runner {
  return async (cmd, args) => {
    const { stdout } = await execFileAsync(cmd, [...args], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  };
}
```

- [ ] **Step 2: Write the failing tests**

`tools/roadmap/test/git.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { collectGit } from "../src/collectors/git.js";
import type { Runner } from "../src/collectors/run.js";

const BRANCHES = [
  "main\t72ecfd29",
  "dev/hotels\t27389802",
  "feat/airline-logo-proxy\t486c4ba1",
].join("\n");

const WORKTREES = [
  "worktree D:/TravStats_Projekt/TravStats",
  "branch refs/heads/main",
  "",
  "worktree D:/TravStats_Projekt/TravStats/.claude/worktrees/hotels",
  "branch refs/heads/dev/hotels",
  "",
].join("\n");

function fakeRunner(aheadCounts: Record<string, string>): Runner {
  return async (_cmd, args) => {
    if (args[0] === "for-each-ref") return BRANCHES;
    if (args[0] === "worktree") return WORKTREES;
    if (args[0] === "rev-list") {
      const branch = args[args.length - 1].replace("main..", "");
      return aheadCounts[branch] ?? "0";
    }
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}

describe("collectGit", () => {
  it("reports branches with their ahead-count and worktree", async () => {
    const result = await collectGit(fakeRunner({ "dev/hotels": "42" }));
    if (!result.ok) throw new Error(result.reason);

    const hotels = result.data.branches.find((b) => b.name === "dev/hotels");
    expect(hotels?.ahead).toBe(42);
    expect(hotels?.worktree).toContain("worktrees/hotels");
    expect(hotels?.head).toBe("27389802");
  });

  it("gives main an ahead-count of zero and no worktree confusion", async () => {
    const result = await collectGit(fakeRunner({}));
    if (!result.ok) throw new Error(result.reason);

    const main = result.data.branches.find((b) => b.name === "main");
    expect(main?.ahead).toBe(0);
  });

  it("reports a failure instead of throwing when git is unavailable", async () => {
    const result = await collectGit(async () => {
      throw new Error("git: command not found");
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toContain("command not found");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/git.test.ts`
Expected: FAIL — cannot resolve `../src/collectors/git.js`.

- [ ] **Step 4: Implement the collector**

`tools/roadmap/src/collectors/git.ts`:

```typescript
import type { CollectorResult } from "../types.js";
import type { Runner } from "./run.js";

export interface GitBranch {
  readonly name: string;
  readonly head: string;
  /** Commits on this branch that main does not have. 0 for main itself. */
  readonly ahead: number;
  readonly worktree: string | null;
}

export interface GitState {
  readonly branches: readonly GitBranch[];
}

const TRUNK = "main";

/** `git worktree list --porcelain` emits stanzas of "worktree <path>" / "branch <ref>". */
function parseWorktrees(porcelain: string): Map<string, string> {
  const byBranch = new Map<string, string>();
  let currentPath: string | null = null;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) currentPath = line.slice("worktree ".length).trim();
    if (line.startsWith("branch ") && currentPath !== null) {
      byBranch.set(line.slice("branch refs/heads/".length).trim(), currentPath);
    }
  }
  return byBranch;
}

export async function collectGit(run: Runner): Promise<CollectorResult<GitState>> {
  try {
    const refs = await run("git", ["for-each-ref", "--format=%(refname:short)\t%(objectname:short)", "refs/heads"]);
    const worktrees = parseWorktrees(await run("git", ["worktree", "list", "--porcelain"]));

    const branches: GitBranch[] = [];
    for (const line of refs.split("\n").filter((l) => l.trim().length > 0)) {
      const [name, head] = line.split("\t");
      const ahead =
        name === TRUNK
          ? 0
          : Number.parseInt((await run("git", ["rev-list", "--count", `${TRUNK}..${name}`])).trim(), 10);
      branches.push({
        name,
        head: head.trim(),
        ahead: Number.isNaN(ahead) ? 0 : ahead,
        worktree: worktrees.get(name) ?? null,
      });
    }

    return { ok: true, data: { branches } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/git.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/roadmap/src/collectors tools/roadmap/test/git.test.ts
git commit -m "feat(roadmap): git collector for branches, worktrees and ahead-counts"
```

---

### Task 4: The GitHub collector

**Files:**
- Create: `tools/roadmap/src/collectors/github.ts`
- Test: `tools/roadmap/test/github.test.ts`

**Interfaces:**
- Consumes: `Runner` from Task 3.
- Produces:
  - `collectGithub(run: Runner): Promise<CollectorResult<GithubState>>`
  - `interface GithubIssue { number: number; title: string; labels: string[]; author: string; url: string }`
  - `interface GithubPr { number: number; title: string; url: string }`
  - `interface GithubState { issues: GithubIssue[]; dependabotPrs: GithubPr[] }`

- [ ] **Step 1: Write the failing tests**

`tools/roadmap/test/github.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { collectGithub } from "../src/collectors/github.js";
import type { Runner } from "../src/collectors/run.js";

const ISSUES = JSON.stringify([
  {
    number: 197,
    title: "Booking- and Ticketnumber fields missing",
    labels: [{ name: "bug" }],
    author: { login: "alexanderkuenzel" },
    url: "https://github.com/Abrechen2/TravStats/issues/197",
  },
  {
    number: 189,
    title: "Airline and aircraft master data",
    labels: [{ name: "enhancement" }],
    author: { login: "Abrechen2" },
    url: "https://github.com/Abrechen2/TravStats/issues/189",
  },
]);

const PRS = JSON.stringify([
  { number: 165, title: "Bump tailwindcss", url: "https://github.com/Abrechen2/TravStats/pull/165" },
]);

const fakeRunner: Runner = async (_cmd, args) => (args[0] === "issue" ? ISSUES : PRS);

describe("collectGithub", () => {
  it("flattens issue labels and author into a plain shape", async () => {
    const result = await collectGithub(fakeRunner);
    if (!result.ok) throw new Error(result.reason);

    const issue = result.data.issues.find((i) => i.number === 197);
    expect(issue?.title).toContain("Booking");
    expect(issue?.labels).toEqual(["bug"]);
    expect(issue?.author).toBe("alexanderkuenzel");
  });

  it("collects the open dependabot PRs", async () => {
    const result = await collectGithub(fakeRunner);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.dependabotPrs).toHaveLength(1);
    expect(result.data.dependabotPrs[0].number).toBe(165);
  });

  it("reports a failure when gh is not authenticated", async () => {
    const result = await collectGithub(async () => {
      throw new Error("gh: not logged in");
    });
    expect(result.ok).toBe(false);
  });

  it("reports a failure on unparseable output rather than crashing", async () => {
    const result = await collectGithub(async () => "not json");
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/github.test.ts`
Expected: FAIL — cannot resolve `../src/collectors/github.js`.

- [ ] **Step 3: Implement the collector**

`tools/roadmap/src/collectors/github.ts`:

```typescript
import { z } from "zod";
import type { CollectorResult } from "../types.js";
import type { Runner } from "./run.js";

export interface GithubIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly author: string;
  readonly url: string;
}

export interface GithubPr {
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

export interface GithubState {
  readonly issues: readonly GithubIssue[];
  readonly dependabotPrs: readonly GithubPr[];
}

const issuesSchema = z.array(
  z.object({
    number: z.number(),
    title: z.string(),
    labels: z.array(z.object({ name: z.string() })),
    author: z.object({ login: z.string() }),
    url: z.string(),
  })
);

const prsSchema = z.array(z.object({ number: z.number(), title: z.string(), url: z.string() }));

export async function collectGithub(run: Runner): Promise<CollectorResult<GithubState>> {
  try {
    const issuesRaw = await run("gh", [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,labels,author,url",
    ]);
    const prsRaw = await run("gh", [
      "pr",
      "list",
      "--state",
      "open",
      "--author",
      "app/dependabot",
      "--limit",
      "50",
      "--json",
      "number,title,url",
    ]);

    const issues = issuesSchema.parse(JSON.parse(issuesRaw)).map((i) => ({
      number: i.number,
      title: i.title,
      labels: i.labels.map((l) => l.name),
      author: i.author.login,
      url: i.url,
    }));

    return {
      ok: true,
      data: { issues, dependabotPrs: prsSchema.parse(JSON.parse(prsRaw)) },
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/github.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/roadmap/src/collectors/github.ts tools/roadmap/test/github.test.ts
git commit -m "feat(roadmap): github collector for open issues and dependabot PRs"
```

---

### Task 5: The deployments collector

Each instance is probed independently and in parallel. One unreachable node must degrade to one grey tile, not to a missing section — the whole point of the fail-soft contract.

**Files:**
- Create: `tools/roadmap/src/collectors/deployments.ts`
- Test: `tools/roadmap/test/deployments.test.ts`

**Interfaces:**
- Consumes: `Runner` from Task 3, `InstanceDef` from Task 2.
- Produces:
  - `collectDeployments(instances: readonly InstanceDef[], run: Runner): Promise<CollectorResult<DeploymentState>>`
  - `interface RunningInstance { id: string; image: string | null; error: string | null }`
  - `interface DeploymentState { running: RunningInstance[] }`

- [ ] **Step 1: Write the failing tests**

`tools/roadmap/test/deployments.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { collectDeployments } from "../src/collectors/deployments.js";
import type { Runner } from "../src/collectors/run.js";
import type { InstanceDef } from "../src/types.js";

const INSTANCES: InstanceDef[] = [
  { id: "prod", label: "Prod", role: "production", node: "10.0.0.1", ct: 100, container: "TravStats" },
  { id: "rc", label: "RC", role: "rc", node: "10.0.0.1", ct: 107, container: "travstats-rc" },
];

describe("collectDeployments", () => {
  it("reports the running image tag per instance", async () => {
    const run: Runner = async (_cmd, args) =>
      args.join(" ").includes("107")
        ? "ghcr.io/abrechen2/travstats:2.4.0-rc.4\n"
        : "ghcr.io/abrechen2/travstats:2.3.1\n";

    const result = await collectDeployments(INSTANCES, run);
    if (!result.ok) throw new Error(result.reason);

    expect(result.data.running.find((r) => r.id === "prod")?.image).toBe("2.3.1");
    expect(result.data.running.find((r) => r.id === "rc")?.image).toBe("2.4.0-rc.4");
  });

  it("degrades ONE unreachable instance to an error tile, keeping the others", async () => {
    const run: Runner = async (_cmd, args) => {
      if (args.join(" ").includes("107")) throw new Error("ssh: connect timed out");
      return "ghcr.io/abrechen2/travstats:2.3.1\n";
    };

    const result = await collectDeployments(INSTANCES, run);
    if (!result.ok) throw new Error("one dead host must not fail the whole collector");

    expect(result.data.running.find((r) => r.id === "prod")?.image).toBe("2.3.1");
    const rc = result.data.running.find((r) => r.id === "rc");
    expect(rc?.image).toBeNull();
    expect(rc?.error).toContain("timed out");
  });

  it("returns an empty result when no instances are configured", async () => {
    const result = await collectDeployments([], async () => "");
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.running).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/deployments.test.ts`
Expected: FAIL — cannot resolve `../src/collectors/deployments.js`.

- [ ] **Step 3: Implement the collector**

`tools/roadmap/src/collectors/deployments.ts`:

```typescript
import type { CollectorResult, InstanceDef } from "../types.js";
import type { Runner } from "./run.js";

export interface RunningInstance {
  readonly id: string;
  /** The image TAG (e.g. "2.4.0-rc.4"), not the full reference. Null when unreachable. */
  readonly image: string | null;
  readonly error: string | null;
}

export interface DeploymentState {
  readonly running: readonly RunningInstance[];
}

/** "ghcr.io/abrechen2/travstats:2.4.0-rc.4" -> "2.4.0-rc.4" */
function toTag(imageRef: string): string {
  const trimmed = imageRef.trim();
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(colon + 1);
}

async function probe(instance: InstanceDef, run: Runner): Promise<RunningInstance> {
  try {
    const raw = await run("ssh", [
      "-o",
      "ConnectTimeout=8",
      "-o",
      "BatchMode=yes",
      `root@${instance.node}`,
      `pct exec ${instance.ct} -- docker inspect --format '{{.Config.Image}}' ${instance.container}`,
    ]);
    const tag = toTag(raw);
    return tag.length > 0
      ? { id: instance.id, image: tag, error: null }
      : { id: instance.id, image: null, error: "container not found" };
  } catch (error) {
    return {
      id: instance.id,
      image: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Probes every instance in parallel. A single dead host produces a marked tile,
 * never a missing section — an unreachable RC server must not hide prod.
 */
export async function collectDeployments(
  instances: readonly InstanceDef[],
  run: Runner
): Promise<CollectorResult<DeploymentState>> {
  const running = await Promise.all(instances.map((instance) => probe(instance, run)));
  return { ok: true, data: { running } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/deployments.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/roadmap/src/collectors/deployments.ts tools/roadmap/test/deployments.test.ts
git commit -m "feat(roadmap): deployment collector probing every instance in parallel

One unreachable host degrades to one marked tile, never to a missing
section — an SSH timeout on the RC server must not hide prod."
```

---

### Task 6: The Discord collector

**Files:**
- Create: `tools/roadmap/src/collectors/discord.ts`
- Test: `tools/roadmap/test/discord.test.ts`

**Interfaces:**
- Consumes: `DiscordWatermark` from Task 2.
- Produces:
  - `type MessageFetcher = (channel: string) => Promise<readonly RawMessage[]>`
  - `interface RawMessage { author: string; timestamp: string; content: string; url: string }`
  - `interface DiscordMessage extends RawMessage { channel: string }`
  - `interface DiscordState { untriaged: DiscordMessage[] }`
  - `collectDiscord(watermarks, fetch: MessageFetcher): Promise<CollectorResult<DiscordState>>`
  - `createDiscordFetcher(): MessageFetcher` — the real one, using `discord.js` and the `tools/discord-setup/.env` credentials.

- [ ] **Step 1: Write the failing tests**

`tools/roadmap/test/discord.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { collectDiscord, type MessageFetcher } from "../src/collectors/discord.js";
import type { DiscordWatermark } from "../src/types.js";

const WATERMARKS: DiscordWatermark[] = [
  { channel: "dev-talk", triagedUpTo: "2026-07-12T12:00:00Z" },
  { channel: "beta-channel", triagedUpTo: "2026-07-12T12:00:00Z" },
];

const fetcher: MessageFetcher = async (channel) =>
  channel === "dev-talk"
    ? [
        { author: "alex", timestamp: "2026-07-12T10:00:00Z", content: "old", url: "u1" },
        { author: "alex", timestamp: "2026-07-12T14:20:00Z", content: "new one", url: "u2" },
        { author: "alex", timestamp: "2026-07-12T16:42:00Z", content: "new two", url: "u3" },
      ]
    : [];

describe("collectDiscord", () => {
  it("returns only messages newer than the channel's watermark", async () => {
    const result = await collectDiscord(WATERMARKS, fetcher);
    if (!result.ok) throw new Error(result.reason);

    expect(result.data.untriaged).toHaveLength(2);
    expect(result.data.untriaged.map((m) => m.content)).toEqual(["new one", "new two"]);
  });

  it("tags each message with its channel, because watermarks are per channel", async () => {
    const result = await collectDiscord(WATERMARKS, fetcher);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.untriaged.every((m) => m.channel === "dev-talk")).toBe(true);
  });

  it("sorts untriaged messages oldest first", async () => {
    const result = await collectDiscord(WATERMARKS, fetcher);
    if (!result.ok) throw new Error(result.reason);
    expect(result.data.untriaged[0].timestamp < result.data.untriaged[1].timestamp).toBe(true);
  });

  it("reports a failure when the bot cannot connect", async () => {
    const result = await collectDiscord(WATERMARKS, async () => {
      throw new Error("DISCORD_BOT_TOKEN is missing");
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/discord.test.ts`
Expected: FAIL — cannot resolve `../src/collectors/discord.js`.

- [ ] **Step 3: Implement the collector**

`tools/roadmap/src/collectors/discord.ts`:

```typescript
import { Client, GatewayIntentBits } from "discord.js";
import { config as loadDotenv } from "dotenv";
import type { CollectorResult, DiscordWatermark } from "../types.js";

export interface RawMessage {
  readonly author: string;
  readonly timestamp: string;
  readonly content: string;
  readonly url: string;
}

export interface DiscordMessage extends RawMessage {
  readonly channel: string;
}

export interface DiscordState {
  readonly untriaged: readonly DiscordMessage[];
}

export type MessageFetcher = (channel: string) => Promise<readonly RawMessage[]>;

const FETCH_LIMIT = 50;

/**
 * Everything past a channel's watermark, oldest first. Messages are NOT turned
 * into items here: one tester post routinely carries half a dozen distinct asks,
 * and splitting it is judgement, not parsing. The tool surfaces; an agent splits.
 */
export async function collectDiscord(
  watermarks: readonly DiscordWatermark[],
  fetch: MessageFetcher
): Promise<CollectorResult<DiscordState>> {
  try {
    const perChannel = await Promise.all(
      watermarks.map(async (mark) => {
        const messages = await fetch(mark.channel);
        return messages
          .filter((m) => m.timestamp > mark.triagedUpTo)
          .map((m) => ({ ...m, channel: mark.channel }));
      })
    );

    const untriaged = perChannel
      .flat()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return { ok: true, data: { untriaged } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The real fetcher. Reuses the bot credentials from tools/discord-setup/.env. */
export function createDiscordFetcher(envPath: string): MessageFetcher {
  loadDotenv({ path: envPath });
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  return async (channelName) => {
    if (!token || !guildId) {
      throw new Error(`DISCORD_BOT_TOKEN / DISCORD_GUILD_ID missing — expected them in ${envPath}`);
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    try {
      await client.login(token);
      const guild = await client.guilds.fetch(guildId);
      await guild.channels.fetch();
      const channel = guild.channels.cache.find((c) => c.name === channelName);
      if (!channel?.isTextBased()) return [];

      const messages = await channel.messages.fetch({ limit: FETCH_LIMIT });
      return [...messages.values()].map((m) => ({
        author: m.author.tag,
        timestamp: m.createdAt.toISOString(),
        content: m.content,
        url: m.url,
      }));
    } finally {
      await client.destroy();
    }
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/discord.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/roadmap/src/collectors/discord.ts tools/roadmap/test/discord.test.ts
git commit -m "feat(roadmap): discord collector surfacing messages past the watermark

Messages are surfaced verbatim, never converted to items: one tester post
routinely carries six distinct asks, and a parser that makes one card out
of it buries five."
```

---

### Task 7: The cache

**Files:**
- Create: `tools/roadmap/src/cache.ts`
- Test: `tools/roadmap/test/cache.test.ts`

**Interfaces:**
- Consumes: `CollectorResult` from Task 2.
- Produces:
  - `interface CachedSection<T> { data: T; collectedAt: string }`
  - `withFallback<T>(result: CollectorResult<T>, cached: CachedSection<T> | undefined, now: Date): { data: T | null; staleSince: string | null; reason: string | null }`
  - `readCache(path: string): Promise<Record<string, CachedSection<unknown>>>` / `writeCache(path, snapshot): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`tools/roadmap/test/cache.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { withFallback } from "../src/cache.js";

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/cache.test.ts`
Expected: FAIL — cannot resolve `../src/cache.js`.

- [ ] **Step 3: Implement the cache**

`tools/roadmap/src/cache.ts`:

```typescript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CollectorResult } from "./types.js";

export interface CachedSection<T> {
  readonly data: T;
  readonly collectedAt: string;
}

export interface Resolved<T> {
  /** Null means: we have nothing. The renderer must say so, not render empty. */
  readonly data: T | null;
  /** Non-null means the data is from the cache, collected at this timestamp. */
  readonly staleSince: string | null;
  readonly reason: string | null;
}

/**
 * Prefers fresh data; falls back to the cache and MARKS it. The one thing this
 * must never do is present cached data as if it were live — an unmarked stale
 * version tag would send someone deploying against the wrong assumption.
 */
export function withFallback<T>(
  result: CollectorResult<T>,
  cached: CachedSection<T> | undefined,
  _now: Date
): Resolved<T> {
  if (result.ok) return { data: result.data, staleSince: null, reason: null };
  if (cached) return { data: cached.data, staleSince: cached.collectedAt, reason: result.reason };
  return { data: null, staleSince: null, reason: result.reason };
}

export async function readCache(path: string): Promise<Record<string, CachedSection<unknown>>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof raw === "object" && raw !== null
      ? (raw as Record<string, CachedSection<unknown>>)
      : {};
  } catch {
    return {};
  }
}

export async function writeCache(
  path: string,
  snapshot: Record<string, CachedSection<unknown>>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot, null, 2), "utf8");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/cache.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/roadmap/src/cache.ts tools/roadmap/test/cache.test.ts
git commit -m "feat(roadmap): collector cache with explicit staleness marking

Cached data is never presented as live — an unmarked stale version tag
would send someone deploying against the wrong assumption."
```

---

### Task 8: The view model — the derived decisions and the Unassigned column

This is where the tool earns its keep. Everything here is a pure function, so everything here is tested.

**Files:**
- Create: `tools/roadmap/src/model.ts`
- Test: `tools/roadmap/test/model.test.ts`

**Interfaces:**
- Consumes: `RoadmapConfig` (Task 2), `GitState` (3), `GithubState` (4), `DeploymentState` (5), `DiscordState` (6), `Resolved` (7).
- Produces:
  - `buildViewModel(input: ModelInput): ViewModel` — pure, no I/O.
  - `ViewModel`, `Decision`, `Card`, `Column`, `InstanceTile` (exported types used by `render.ts`).

- [ ] **Step 1: Write the failing tests**

`tools/roadmap/test/model.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildViewModel, type ModelInput } from "../src/model.js";
import type { RoadmapConfig } from "../src/types.js";

const CONFIG: RoadmapConfig = {
  instances: [
    { id: "prod", label: "Prod", role: "production", node: "10.0.0.1", ct: 100, container: "TravStats", expect: "2.3.1" },
  ],
  discord: [{ channel: "dev-talk", triagedUpTo: "2026-07-12T12:00:00Z" }],
  versions: [
    { id: "2.4.0", state: "rc", branch: "main" },
    { id: "2.5.0", state: "awaiting-merge", branch: "dev/immich-albums" },
  ],
  items: [
    { id: "gh-197", source: { type: "github", ref: 197 }, version: "2.4.0", status: "fixed-awaiting-release" },
    { id: "gh-186", source: { type: "github", ref: 186 }, version: "2.4.0", status: "fixed-awaiting-release" },
    { id: "gh-154", source: { type: "github", ref: 154 }, version: "2.5.0", status: "done" },
    { id: "d-nav", source: { type: "discord" }, title: "Nav submenus", version: "backlog", status: "planned" },
  ],
};

function input(overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    config: CONFIG,
    generatedAt: "2026-07-13T12:00:00Z",
    git: { data: { branches: [{ name: "dev/immich-albums", head: "9f8397fa", ahead: 81, worktree: null }] }, staleSince: null, reason: null },
    github: {
      data: {
        issues: [
          { number: 197, title: "Booking number missing", labels: ["bug"], author: "alex", url: "u197" },
          { number: 186, title: "Profile picture lost", labels: ["bug"], author: "alex", url: "u186" },
          { number: 154, title: "Link Immich album", labels: [], author: "alex", url: "u154" },
          { number: 200, title: "Actual and scheduled times", labels: [], author: "alex", url: "u200" },
        ],
        dependabotPrs: [],
      },
      staleSince: null,
      reason: null,
    },
    deployments: { data: { running: [{ id: "prod", image: "2.3.1", error: null }] }, staleSince: null, reason: null },
    discord: { data: { untriaged: [] }, staleSince: null, reason: null },
    ...overrides,
  };
}

describe("buildViewModel", () => {
  it("puts an open issue that no item claims into the Unassigned column", () => {
    const vm = buildViewModel(input());
    const unassigned = vm.columns.find((c) => c.versionId === "unassigned");
    expect(unassigned?.cards.map((c) => c.sourceRef)).toEqual([200]);
  });

  it("reads a github card's title live and never from the config", () => {
    const vm = buildViewModel(input());
    const card = vm.columns.flatMap((c) => c.cards).find((c) => c.sourceRef === 197);
    expect(card?.title).toBe("Booking number missing");
  });

  it("derives a promote decision naming how many issues it closes", () => {
    const vm = buildViewModel(input());
    const promote = vm.decisions.find((d) => d.kind === "promote");
    expect(promote?.headline).toContain("2.4.0");
    expect(promote?.headline).toContain("2");
  });

  it("derives a merge decision for an awaiting-merge version whose branch is ahead", () => {
    const vm = buildViewModel(input());
    const merge = vm.decisions.find((d) => d.kind === "merge");
    expect(merge?.headline).toContain("2.5.0");
    expect(merge?.detail.join(" ")).toContain("81");
  });

  it("does NOT derive a merge decision when the branch is already merged", () => {
    const vm = buildViewModel(
      input({
        git: { data: { branches: [{ name: "dev/immich-albums", head: "9f8397fa", ahead: 0, worktree: null }] }, staleSince: null, reason: null },
      })
    );
    expect(vm.decisions.find((d) => d.kind === "merge")).toBeUndefined();
  });

  it("derives a triage decision when discord has untriaged messages", () => {
    const vm = buildViewModel(
      input({
        discord: {
          data: { untriaged: [{ channel: "dev-talk", author: "alex", timestamp: "2026-07-12T14:20:00Z", content: "six asks", url: "u" }] },
          staleSince: null,
          reason: null,
        },
      })
    );
    expect(vm.decisions.find((d) => d.kind === "triage")?.headline).toContain("1");
  });

  it("flags an instance whose running version differs from the expected one", () => {
    const vm = buildViewModel(
      input({
        deployments: { data: { running: [{ id: "prod", image: "2.2.0", error: null }] }, staleSince: null, reason: null },
      })
    );
    expect(vm.instances[0].mismatch).toBe(true);
  });

  it("marks a section as stale instead of dropping it when its collector failed", () => {
    const vm = buildViewModel(
      input({
        deployments: { data: { running: [{ id: "prod", image: "2.3.1", error: null }] }, staleSince: "2026-07-13T09:00:00Z", reason: "ssh timeout" },
      })
    );
    expect(vm.warnings.some((w) => w.includes("ssh timeout"))).toBe(true);
    expect(vm.instances).toHaveLength(1);
  });

  it("says so explicitly when there is nothing to decide", () => {
    const bare: RoadmapConfig = { ...CONFIG, items: [], versions: [], discord: [] };
    const vm = buildViewModel({ ...input(), config: bare });
    expect(vm.decisions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/model.test.ts`
Expected: FAIL — cannot resolve `../src/model.js`.

- [ ] **Step 3: Implement the view model**

`tools/roadmap/src/model.ts`:

```typescript
import type { Resolved } from "./cache.js";
import type { DeploymentState } from "./collectors/deployments.js";
import type { DiscordMessage, DiscordState } from "./collectors/discord.js";
import type { GitState } from "./collectors/git.js";
import type { GithubPr, GithubState } from "./collectors/github.js";
import { BACKLOG, UNASSIGNED, type ItemStatus, type RoadmapConfig, type SourceType, type VersionState } from "./types.js";

export interface ModelInput {
  readonly config: RoadmapConfig;
  readonly generatedAt: string;
  readonly git: Resolved<GitState>;
  readonly github: Resolved<GithubState>;
  readonly deployments: Resolved<DeploymentState>;
  readonly discord: Resolved<DiscordState>;
}

export interface Card {
  readonly id: string;
  readonly title: string;
  readonly source: SourceType;
  readonly sourceRef: number | null;
  readonly url: string | null;
  readonly status: ItemStatus;
  readonly branch: string | null;
  readonly notes: string | null;
}

export interface Column {
  readonly versionId: string;
  readonly state: VersionState | null;
  readonly note: string | null;
  readonly cards: readonly Card[];
}

export interface Decision {
  readonly kind: "merge" | "promote" | "blocked" | "triage";
  readonly headline: string;
  readonly detail: readonly string[];
}

export interface InstanceTile {
  readonly id: string;
  readonly label: string;
  readonly role: string;
  readonly running: string | null;
  readonly expected: string | null;
  readonly mismatch: boolean;
  readonly error: string | null;
}

export interface ViewModel {
  readonly generatedAt: string;
  readonly decisions: readonly Decision[];
  readonly instances: readonly InstanceTile[];
  readonly columns: readonly Column[];
  readonly untriaged: readonly DiscordMessage[];
  readonly branches: GitState["branches"];
  readonly dependabotPrs: readonly GithubPr[];
  readonly warnings: readonly string[];
}

function warningsFor(input: ModelInput): string[] {
  const sections: ReadonlyArray<[string, Resolved<unknown>]> = [
    ["Git", input.git],
    ["GitHub", input.github],
    ["Instances", input.deployments],
    ["Discord", input.discord],
  ];

  return sections.flatMap(([label, section]) => {
    if (section.reason === null) return [];
    return section.staleSince === null
      ? [`${label}: unavailable (${section.reason}) — no cached state, section is empty`]
      : [`${label}: ${section.reason} — showing cached state from ${section.staleSince}`];
  });
}

function buildColumns(input: ModelInput): Column[] {
  const { config } = input;
  const issues = input.github.data?.issues ?? [];
  const issueByNumber = new Map(issues.map((i) => [i.number, i]));

  const toCard = (item: RoadmapConfig["items"][number]): Card => {
    const live = item.source.ref !== undefined ? issueByNumber.get(item.source.ref) : undefined;
    return {
      id: item.id,
      // A github title is ALWAYS live. If the issue is gone (closed, deleted),
      // say so rather than inventing a title from the config.
      title: item.title ?? live?.title ?? `#${item.source.ref ?? "?"} (not among the open issues)`,
      source: item.source.type,
      sourceRef: item.source.ref ?? null,
      url: live?.url ?? item.source.url ?? null,
      status: item.status,
      branch: item.branch ?? null,
      notes: item.notes ?? null,
    };
  };

  const declared: Column[] = config.versions.map((version) => ({
    versionId: version.id,
    state: version.state,
    note: version.note ?? null,
    cards: config.items.filter((i) => i.version === version.id).map(toCard),
  }));

  const backlog: Column = {
    versionId: BACKLOG,
    state: null,
    note: null,
    cards: config.items.filter((i) => i.version === BACKLOG).map(toCard),
  };

  // The anti-drift column: every open issue that no item claims.
  const claimed = new Set(
    config.items.map((i) => i.source.ref).filter((ref): ref is number => ref !== undefined)
  );
  const unassigned: Column = {
    versionId: UNASSIGNED,
    state: null,
    note: null,
    cards: issues
      .filter((issue) => !claimed.has(issue.number))
      .map((issue) => ({
        id: `gh-${issue.number}`,
        title: issue.title,
        source: "github" as const,
        sourceRef: issue.number,
        url: issue.url,
        status: "planned" as const,
        branch: null,
        notes: null,
      })),
  };

  return [...declared, backlog, unassigned];
}

function buildDecisions(input: ModelInput, columns: readonly Column[]): Decision[] {
  const decisions: Decision[] = [];
  const branches = input.git.data?.branches ?? [];

  // 1. A finished line that is not in main is a decision, not a task.
  for (const version of input.config.versions) {
    if (version.state !== "awaiting-merge" || version.branch === undefined) continue;
    const branch = branches.find((b) => b.name === version.branch);
    if (!branch || branch.ahead === 0) continue;

    const riders = columns.find((c) => c.versionId === version.id)?.cards ?? [];
    decisions.push({
      kind: "merge",
      headline: `Merge decision open: ${version.id} (${version.branch})`,
      detail: [
        `${branch.ahead} commits ahead of main`,
        riders.length > 0 ? `carries ${riders.length} item(s): ${riders.map((c) => c.title).join(", ")}` : "carries no tracked items",
      ],
    });
  }

  // 2. Fixed work waiting on a release — the thing that had 13 issues hostage.
  const waitingByVersion = new Map<string, Card[]>();
  for (const column of columns) {
    const waiting = column.cards.filter((c) => c.status === "fixed-awaiting-release");
    if (waiting.length > 0) waitingByVersion.set(column.versionId, waiting);
  }
  for (const [versionId, waiting] of waitingByVersion) {
    decisions.push({
      kind: "promote",
      headline: `Promote ${versionId} — closes ${waiting.length} issue(s)`,
      detail: waiting.map((c) => `${c.sourceRef !== null ? `#${c.sourceRef} ` : ""}${c.title}`),
    });
  }

  // 3. Anything explicitly blocked names its blocker.
  const blocked = columns.flatMap((c) => c.cards).filter((c) => c.status === "blocked");
  if (blocked.length > 0) {
    decisions.push({
      kind: "blocked",
      headline: `${blocked.length} item(s) blocked`,
      detail: blocked.map((c) => c.title),
    });
  }

  // 4. Feedback nobody has sorted yet.
  const untriaged = input.discord.data?.untriaged ?? [];
  if (untriaged.length > 0) {
    decisions.push({
      kind: "triage",
      headline: `${untriaged.length} untriaged Discord message(s)`,
      detail: untriaged.map((m) => `#${m.channel} · ${m.author} · ${m.timestamp}`),
    });
  }

  return decisions;
}

function buildInstances(input: ModelInput): InstanceTile[] {
  const running = input.deployments.data?.running ?? [];

  return input.config.instances.map((instance) => {
    const live = running.find((r) => r.id === instance.id);
    const image = live?.image ?? null;
    return {
      id: instance.id,
      label: instance.label,
      role: instance.role,
      running: image,
      expected: instance.expect ?? null,
      mismatch: instance.expect !== undefined && image !== null && image !== instance.expect,
      error: live?.error ?? null,
    };
  });
}

/** Pure: the whole judgement of the tool, and therefore the whole test surface. */
export function buildViewModel(input: ModelInput): ViewModel {
  const columns = buildColumns(input);

  return {
    generatedAt: input.generatedAt,
    decisions: buildDecisions(input, columns),
    instances: buildInstances(input),
    columns,
    untriaged: input.discord.data?.untriaged ?? [],
    branches: input.git.data?.branches ?? [],
    dependabotPrs: input.github.data?.dependabotPrs ?? [],
    warnings: warningsFor(input),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/model.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/roadmap/src/model.ts tools/roadmap/test/model.test.ts
git commit -m "feat(roadmap): view model with derived decisions and the Unassigned column

The decisions are computed, not authored: a finished branch that is not in
main, fixed work waiting on a release, blocked items, untriaged feedback.
Any open issue no item claims lands in Unassigned — which is how a Discord
promise stops evaporating."
```

---

### Task 9: The renderer

**Files:**
- Create: `tools/roadmap/src/render.ts`
- Test: `tools/roadmap/test/render.test.ts`

**Interfaces:**
- Consumes: `ViewModel` from Task 8.
- Produces: `render(vm: ViewModel): string` — a complete, self-contained HTML document (inline CSS + one inline script for the filters). No external requests.

- [ ] **Step 1: Write the failing tests**

`tools/roadmap/test/render.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { render } from "../src/render.js";
import type { ViewModel } from "../src/model.js";

const VM: ViewModel = {
  generatedAt: "2026-07-13T12:00:00Z",
  decisions: [{ kind: "promote", headline: "Promote 2.4.0 — closes 13 issue(s)", detail: ["#197 Booking number"] }],
  instances: [
    { id: "prod", label: "Prod", role: "production", running: "2.3.1", expected: "2.3.1", mismatch: false, error: null },
  ],
  columns: [
    {
      versionId: "2.4.0",
      state: "rc",
      note: null,
      cards: [
        { id: "gh-197", title: "Booking number missing", source: "github", sourceRef: 197, url: "u197", status: "fixed-awaiting-release", branch: "main", notes: "context" },
      ],
    },
    { versionId: "unassigned", state: null, note: null, cards: [] },
  ],
  untriaged: [{ channel: "dev-talk", author: "alex", timestamp: "2026-07-12T14:20:00Z", content: "six asks", url: "u" }],
  branches: [{ name: "dev/hotels", head: "27389802", ahead: 42, worktree: "/w/hotels" }],
  dependabotPrs: [{ number: 165, title: "Bump tailwindcss", url: "u165" }],
  warnings: ["Instances: ssh timeout — showing cached state from 2026-07-13T09:00:00Z"],
};

describe("render", () => {
  it("renders all four zones", () => {
    const html = render(VM);
    expect(html).toContain("Jetzt dran");
    expect(html).toContain("Instanzen");
    expect(html).toContain("2.4.0");
    expect(html).toContain("dev/hotels");
  });

  it("renders the untriaged discord messages verbatim", () => {
    expect(render(VM)).toContain("six asks");
  });

  it("shows the staleness warning rather than hiding it", () => {
    expect(render(VM)).toContain("ssh timeout");
  });

  it("is self-contained — no external requests", () => {
    const html = render(VM);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });

  it("escapes HTML in user-supplied content", () => {
    const evil: ViewModel = {
      ...VM,
      untriaged: [{ channel: "dev-talk", author: "alex", timestamp: "t", content: "<script>alert(1)</script>", url: "u" }],
    };
    const html = render(evil);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/roadmap && npx vitest --run test/render.test.ts`
Expected: FAIL — cannot resolve `../src/render.js`.

- [ ] **Step 3: Implement the renderer**

`tools/roadmap/src/render.ts`:

```typescript
import type { Card, Column, ViewModel } from "./model.js";

/** Discord content and issue titles are user-supplied. They get escaped, always. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
:root { color-scheme: dark; --bg:#12141a; --card:#1b1e26; --line:#2a2e39; --text:#e6e8ee;
        --muted:#8b90a0; --amber:#f0a947; --red:#e0605e; --green:#7bc47f; --blue:#4aa6b0; }
* { box-sizing:border-box; }
body { margin:0; padding:24px; background:var(--bg); color:var(--text);
       font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:15px; margin:28px 0 10px; color:var(--muted);
     text-transform:uppercase; letter-spacing:.08em; }
.meta { color:var(--muted); font-size:12px; margin-bottom:20px; }
.warn { border-left:3px solid var(--amber); background:#241f16; padding:8px 12px; margin:6px 0;
        border-radius:0 4px 4px 0; font-size:13px; }
.decision { border:1px solid var(--line); border-left:3px solid var(--red); background:var(--card);
            padding:12px 14px; border-radius:0 6px 6px 0; margin-bottom:8px; }
.decision.merge { border-left-color:var(--amber); } .decision.triage { border-left-color:var(--blue); }
.decision h3 { margin:0 0 6px; font-size:14px; } .decision ul { margin:0; padding-left:18px; color:var(--muted); }
.tiles { display:flex; flex-wrap:wrap; gap:10px; }
.tile { border:1px solid var(--line); background:var(--card); border-radius:6px; padding:10px 14px; min-width:150px; }
.tile .v { font-size:16px; font-weight:600; } .tile.bad .v { color:var(--red); }
.tile .r { color:var(--muted); font-size:12px; }
.board { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; }
.col { min-width:260px; flex:0 0 260px; }
.col h3 { margin:0 0 8px; font-size:13px; display:flex; justify-content:space-between; }
.col .n { color:var(--muted); font-weight:400; }
.card { border:1px solid var(--line); background:var(--card); border-radius:6px; padding:10px; margin-bottom:8px; }
.card summary { cursor:pointer; list-style:none; } .card summary::-webkit-details-marker { display:none; }
.card .badges { margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; }
.b { font-size:11px; padding:1px 6px; border-radius:10px; border:1px solid var(--line); color:var(--muted); }
.b.fixed-awaiting-release { border-color:var(--green); color:var(--green); }
.b.blocked { border-color:var(--red); color:var(--red); }
.card .notes { margin-top:8px; padding-top:8px; border-top:1px solid var(--line); color:var(--muted);
               white-space:pre-wrap; font-size:13px; }
.msg { border:1px solid var(--line); background:var(--card); border-radius:6px; padding:10px; margin-bottom:8px; }
.msg .h { color:var(--muted); font-size:12px; margin-bottom:4px; }
.msg .c { white-space:pre-wrap; }
table { border-collapse:collapse; width:100%; } td,th { text-align:left; padding:5px 10px 5px 0;
        border-bottom:1px solid var(--line); font-size:13px; } th { color:var(--muted); font-weight:500; }
a { color:var(--blue); }
`;

function renderCard(card: Card): string {
  const link =
    card.url !== null
      ? `<a href="${esc(card.url)}">${card.sourceRef !== null ? `#${card.sourceRef}` : "link"}</a> `
      : "";
  const notes = card.notes !== null ? `<div class="notes">${esc(card.notes)}</div>` : "";

  return `<details class="card"><summary>${link}${esc(card.title)}
    <div class="badges">
      <span class="b ${esc(card.status)}">${esc(card.status)}</span>
      <span class="b">${esc(card.source)}</span>
      ${card.branch !== null ? `<span class="b">${esc(card.branch)}</span>` : ""}
    </div></summary>${notes}</details>`;
}

function renderColumn(column: Column): string {
  const state = column.state !== null ? ` · ${esc(column.state)}` : "";
  return `<div class="col">
    <h3><span>${esc(column.versionId)}${state}</span><span class="n">${column.cards.length}</span></h3>
    ${column.cards.map(renderCard).join("")}
  </div>`;
}

export function render(vm: ViewModel): string {
  const decisions =
    vm.decisions.length > 0
      ? vm.decisions
          .map(
            (d) => `<div class="decision ${esc(d.kind)}">
              <h3>${esc(d.headline)}</h3>
              <ul>${d.detail.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
            </div>`
          )
          .join("")
      : `<p class="meta">Nichts zu entscheiden — kein fertiger Branch, keine wartenden Fixes, keine offene Triage.</p>`;

  const tiles = vm.instances
    .map(
      (i) => `<div class="tile ${i.mismatch || i.error !== null ? "bad" : ""}">
        <div class="v">${esc(i.running ?? "—")}</div>
        <div class="r">${esc(i.label)} · ${esc(i.role)}</div>
        ${i.mismatch ? `<div class="r">erwartet: ${esc(i.expected ?? "")}</div>` : ""}
        ${i.error !== null ? `<div class="r">${esc(i.error)}</div>` : ""}
      </div>`
    )
    .join("");

  const messages = vm.untriaged
    .map(
      (m) => `<div class="msg">
        <div class="h">#${esc(m.channel)} · ${esc(m.author)} · ${esc(m.timestamp)} · <a href="${esc(m.url)}">öffnen</a></div>
        <div class="c">${esc(m.content)}</div>
      </div>`
    )
    .join("");

  const branchRows = vm.branches
    .map(
      (b) => `<tr><td>${esc(b.name)}</td><td>${b.ahead}</td><td>${esc(b.worktree ?? "—")}</td></tr>`
    )
    .join("");

  const prRows = vm.dependabotPrs
    .map((p) => `<tr><td><a href="${esc(p.url)}">#${p.number}</a></td><td>${esc(p.title)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>TravStats — Roadmap</title>
<style>${STYLE}</style></head>
<body>
  <h1>TravStats — Roadmap</h1>
  <div class="meta">Erzeugt: ${esc(vm.generatedAt)}</div>
  ${vm.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("")}

  <h2>Jetzt dran</h2>
  ${decisions}

  <h2>Instanzen</h2>
  <div class="tiles">${tiles}</div>

  <h2>Versionen</h2>
  <div class="board">${vm.columns.map(renderColumn).join("")}</div>

  ${vm.untriaged.length > 0 ? `<h2>Untriagiert (Discord)</h2>${messages}` : ""}

  <h2>Branches</h2>
  <table><thead><tr><th>Branch</th><th>ahead</th><th>Worktree</th></tr></thead><tbody>${branchRows}</tbody></table>

  ${vm.dependabotPrs.length > 0 ? `<h2>Dependabot</h2><table><tbody>${prRows}</tbody></table>` : ""}
</body></html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/roadmap && npx vitest --run test/render.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/roadmap/src/render.ts tools/roadmap/test/render.test.ts
git commit -m "feat(roadmap): self-contained HTML renderer with escaped user content"
```

---

### Task 10: Wire it together

**Files:**
- Create: `tools/roadmap/src/index.ts`
- Create: `tools/roadmap/README.md`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces: the `npm run roadmap` entry point. No exports.

- [ ] **Step 1: Write the entry point**

`tools/roadmap/src/index.ts`:

```typescript
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readCache, withFallback, writeCache, type CachedSection } from "./cache.js";
import { collectDeployments } from "./collectors/deployments.js";
import { collectDiscord, createDiscordFetcher } from "./collectors/discord.js";
import { collectGit } from "./collectors/git.js";
import { collectGithub } from "./collectors/github.js";
import { execRunner } from "./collectors/run.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { buildViewModel } from "./model.js";
import { render } from "./render.js";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const CONFIG_PATH = resolve(REPO_ROOT, "roadmap.local.yaml");
const OUT_DIR = resolve(REPO_ROOT, ".roadmap");
const OUT_HTML = resolve(OUT_DIR, "index.html");
const CACHE_PATH = resolve(OUT_DIR, "cache.json");
const DISCORD_ENV = resolve(REPO_ROOT, "tools", "discord-setup", ".env");

function openInBrowser(path: string): void {
  const cmd = process.platform === "win32" ? "cmd" : "open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function main(): Promise<void> {
  const skipSsh = process.argv.includes("--no-ssh");
  const skipDiscord = process.argv.includes("--no-discord");

  const config = loadConfig(await readFile(CONFIG_PATH, "utf8"));
  const cache = await readCache(CACHE_PATH);
  const run = execRunner(20_000);
  const now = new Date();
  const generatedAt = now.toISOString();

  log("Collecting …");
  const [git, github, deployments, discord] = await Promise.all([
    collectGit(run),
    collectGithub(run),
    skipSsh
      ? Promise.resolve({ ok: false as const, reason: "--no-ssh" })
      : collectDeployments(config.instances, run),
    skipDiscord
      ? Promise.resolve({ ok: false as const, reason: "--no-discord" })
      : collectDiscord(config.discord, createDiscordFetcher(DISCORD_ENV)),
  ]);

  const sections = { git, github, deployments, discord };
  const resolved = {
    git: withFallback(git, cache.git as CachedSection<never> | undefined, now),
    github: withFallback(github, cache.github as CachedSection<never> | undefined, now),
    deployments: withFallback(deployments, cache.deployments as CachedSection<never> | undefined, now),
    discord: withFallback(discord, cache.discord as CachedSection<never> | undefined, now),
  };

  const vm = buildViewModel({ config, generatedAt, ...resolved });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_HTML, render(vm), "utf8");

  // Only successful collections refresh the cache — a failure must never
  // overwrite good data with an empty result.
  const nextCache = { ...cache };
  for (const [key, section] of Object.entries(sections)) {
    if (section.ok) nextCache[key] = { data: section.data, collectedAt: generatedAt };
  }
  await writeCache(CACHE_PATH, nextCache);

  for (const warning of vm.warnings) log(`  ! ${warning}`);
  log(`${vm.decisions.length} decision(s) · ${vm.untriaged.length} untriaged · ${OUT_HTML}`);
  openInBrowser(OUT_HTML);
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Write the README**

`tools/roadmap/README.md`:

```markdown
# Roadmap board

Generates `<repo-root>/.roadmap/index.html` — one page joining the curated
roadmap with live data from git, GitHub, Discord and the running deployments.

## Setup

1. `npm install` in this directory.
2. Copy `roadmap.local.example.yaml` to `<repo-root>/roadmap.local.yaml` and fill
   in the instances from `CLAUDE.local.md`. **That file is gitignored — never
   commit it, and never put real hosts in the example.**
3. Discord reads reuse `tools/discord-setup/.env` (bot token + guild id).
4. GitHub reads use the `gh` CLI — run `gh auth status` if issues are missing.

## Use

```bash
npm run roadmap                  # from the repo root
npm run roadmap -- --no-ssh      # skip the deployment probe (offline / fast)
npm run roadmap -- --no-discord  # skip the Discord fetch
```

A failed collector never fails the page: it falls back to the last cached state
and says so at the top. The cache is only refreshed by a *successful* collection.

## Triage

Untriaged Discord messages (anything newer than a channel's `triagedUpTo`) are
listed verbatim. Splitting them into items is a judgement call — ask Claude to
triage, review the proposal, and only then does the watermark advance.
```

- [ ] **Step 3: Typecheck**

Run: `cd tools/roadmap && npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Run the whole suite**

Run: `cd tools/roadmap && npx vitest --run`
Expected: PASS — 34 tests across 6 files.

- [ ] **Step 5: Commit**

```bash
git add tools/roadmap/src/index.ts tools/roadmap/README.md
git commit -m "feat(roadmap): wire collectors, model and renderer into the CLI

A failed collector falls back to the cached state and says so; only a
successful collection refreshes the cache, so a dead SSH hop can never
overwrite good data with an empty result."
```

---

### Task 11: Migrate ROADMAP.local.md and run it for real

The first real run is also the acceptance test: the page must show what we already know to be true — prod on 2.3.1, three unmerged lines, thirteen fixed issues waiting, and Alex's Discord feedback either triaged into items or listed as untriaged.

**Files:**
- Create: `roadmap.local.yaml` (repo root — **gitignored, never committed**)
- Modify: `ROADMAP.local.md` → rename to `ROADMAP.local.md.archive`

**Interfaces:**
- Consumes: the schema from Task 2, the instance list from `CLAUDE.local.md`.
- Produces: the curated data layer.

- [ ] **Step 1: Write the config from the known state**

Create `roadmap.local.yaml` at the repo root. Port every table row of
`ROADMAP.local.md` into an item and every narrative section into the `notes` of
the item (or the `note` of the version) it belongs to. Fill `instances` from
`CLAUDE.local.md` — six entries: prod (CT 100), rc (CT 107), beta (CT 106) and
the three CT 134 preview slots.

Known state at the time of writing, to be reproduced exactly:

- Versions: `2.3.1` (released), `2.4.0` (rc, branch `main`), `2.5.0`
  (awaiting-merge, branch `dev/immich-albums`), `2.6.0` (awaiting-merge, branch
  `dev/hotels`), plus a version for the stacked logo/table line
  (awaiting-merge, branch `feat/flights-table-redesign`).
- `fixed-awaiting-release` on 2.4.0: issues 178, 183, 185, 186, 187, 188, 190,
  192, 193, 194, 195, 196, 197.
- 2.5.0 carries issues 154, 179, 181, 182.
- Unassigned by design (they must appear in the Unassigned column, proving it
  works): 175, 177, 184, 189, 191, 198, 199, 200.
- Discord watermarks: `dev-talk` and `beta-channel`, both set to a timestamp
  BEFORE Alex's 2026-07-12 14:20 message, so the first run surfaces his lodging
  feedback as untriaged — that is the acceptance criterion for the triage path.

- [ ] **Step 2: Prove the config is ignored before it exists in a commit**

Run:

```bash
git status --short roadmap.local.yaml; git check-ignore -v roadmap.local.yaml
```

Expected: `git status` prints **nothing** for that path (it is ignored, not
untracked-and-visible), and `check-ignore` prints the matching rule. If
`git status` lists the file, STOP — the internal roadmap is one `git add -A`
away from the public repo.

- [ ] **Step 3: Run the tool for real**

Run:

```bash
npm run roadmap
```

Expected: the browser opens `.roadmap/index.html`. Verify against known truth:

- "Jetzt dran" names the 2.4.0 promote decision and says it closes 13 issues.
- Three merge decisions (immich, hotels, logo/table) with their ahead-counts.
- The instance tiles read: prod `2.3.1`, rc `2.4.0-rc.4`, beta
  `2.4.0-hotels-beta.3`, and the three preview slots.
- The Unassigned column holds exactly 175, 177, 184, 189, 191, 198, 199, 200.
- Alex's two 2026-07-12 messages appear verbatim under "Untriagiert".

- [ ] **Step 4: Run with the network off**

Run: `npm run roadmap -- --no-ssh --no-discord`
Expected: the page still builds; the top shows two warnings naming `--no-ssh` and
`--no-discord`; the instance tiles show the **cached** values with the staleness
line, not blanks.

- [ ] **Step 5: Archive the old roadmap**

```bash
git mv ROADMAP.local.md ROADMAP.local.md.archive 2>/dev/null || mv ROADMAP.local.md ROADMAP.local.md.archive
```

(Both paths are covered by the `*.md` ignore rule, so this is a local move, not a
tracked change. Keep the archive until the board has carried one release cycle.)

- [ ] **Step 6: Commit**

Only the tool changes are committed — the data file is ignored by design.

```bash
git status --short   # must NOT list roadmap.local.yaml
git commit --allow-empty -m "chore(roadmap): first real run verified against known state

Prod 2.3.1, three unmerged lines, 13 fixed issues awaiting promote, eight
unassigned issues and Alex's two untriaged Discord messages all reproduce."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Three stages (collect / merge / render) | 3–6, 8, 9 |
| Two data layers, curated YAML | 2, 11 |
| Live collectors (git, GitHub, SSH, Discord) | 3, 4, 5, 6 |
| Derived "Now" zone (4 rules) | 8 |
| Four page zones | 9 |
| Unassigned column | 8 |
| Discord triage + per-channel watermark | 6, 8, 11 |
| Fail-soft + cache + staleness marking | 5, 7, 10 |
| gitignore traps proven | 1, 11 |
| No hosts/IPs in committed code | 1 (example uses placeholders), 11 (real values in the ignored file) |
| Migration from ROADMAP.local.md | 11 |
| Testing (unit + snapshot, no E2E) | every task |

**Type consistency:** `CollectorResult<T>` is defined once in `types.ts` and used
by all four collectors. `Resolved<T>` (Task 7) is what `ModelInput` consumes
(Task 8) — the collectors' raw results are converted by `withFallback` in
`index.ts` (Task 10) before reaching the model. `Card`, `Column`, `Decision`,
`InstanceTile` and `ViewModel` are defined in `model.ts` and consumed unchanged
by `render.ts`.

**Deliberate gap:** the triage *write* path (agent proposes items → owner
approves → YAML updated, watermark advances) is a Claude workflow, not code. It
needs no implementation beyond the schema (Task 2) and the surfacing (Task 6).
