# Brief: make the roadmap board a central, multi-project tool

> **Status 2026-07-14: DONE.** The tool now lives at `D:/Projekte/CC/tools/roadmap`
> (123 tests green) and serves TravStats and Sublarr. It is no longer in this repo:
> this branch keeps only the `.gitignore` entries and these documents. Each project
> keeps its own gitignored `roadmap.local.yaml` + `.roadmap/`.
>
> Two assumptions that only a SECOND project could expose, both fixed and both now
> configuration rather than constants:
>
> - **The trunk was hardcoded to `main`.** Sublarr's is `master`, so every
>   ahead-count ran `main..<branch>` against a revision that does not exist — and
>   the first failure took the ENTIRE git section down with it. Now `trunk:` in the
>   YAML (default `main`), checked against the branch list, with the fix named in
>   the error. A missing `git` still reports as a missing git, not a missing trunk.
> - **The page title said "TravStats" on every board.** Now `project:` in the YAML,
>   defaulting to the repo directory's name.
>
> Also: a project with no Discord gets no Discord SECTION, not merely no warning —
> an empty "keine untriagierten Nachrichten" block implies a source that is being
> watched.

The roadmap board currently lives inside the TravStats repo at
`D:/TravStats_Projekt/TravStats/.claude/worktrees/roadmap/tools/roadmap` (branch
`feat/roadmap-board`). It works: 85 tests green, live-verified. The owner now wants it as the
**standard for TWO projects** (TravStats and Sublarr), maintained by Claude and opened, refreshed,
at every session start.

So it must stop being a TravStats-internal tool and become a repo-agnostic one.

## Where it goes

Copy the whole `tools/roadmap` package to **`D:/Projekte/CC/tools/roadmap`** — an existing git repo
(local-only, no remote), which gives the tool version history. It is no longer inside either
product repo.

Per project, only the curated data file stays in the project:
- `<project-repo-root>/roadmap.local.yaml` (gitignored — holds real IPs; both repos are PUBLIC)
- `<project-repo-root>/.roadmap/` (generated page + cache, gitignored)

## Required changes

**1. The repo root is no longer derived from the module's own path.**
Today `index.ts` resolves it via `fileURLToPath(import.meta.url)` + `../../..`, which assumed the
tool sat inside the repo. It now runs from anywhere. Resolve the target repo as:
  - `--repo <path>` if given, else
  - `git rev-parse --show-toplevel` executed in `process.cwd()`.
If neither yields a repo, exit with a readable message (no stack trace).

**2. Instances need two probe kinds.** Today the probe is Proxmox-only
(`ssh root@node "pct exec <ct> -- docker inspect …"`). Sublarr's production runs on **Unraid**, where
there is no `pct` — it is a plain `ssh root@host "docker inspect …"`. Add a `via` field:

```yaml
instances:
  - id: prod
    label: Prod
    role: production
    via: proxmox        # ssh <node> -> pct exec <ct> -> docker inspect <container>
    node: <host>
    ct: 100
    container: TravStats
    expect: "2.4.0"

  - id: cardinal
    label: Cardinal
    role: production
    via: docker         # ssh <host> -> docker inspect <container>
    node: <host>
    container: sublarr
    expect: "1.2.3"
```

`via: proxmox` requires `ct`; `via: docker` must reject a `ct` (it would be meaningless). Enforce
both in the Zod schema with a readable error. Keep `via` **required** — no silent default that
would send a Proxmox command to an Unraid box.

**3. Discord becomes optional.** Sublarr has no Discord. When the config has no `discord:` section
(or an empty one), the collector must simply not run — and produce **no warning**, because nothing
is wrong. (Today a skipped collector is marked stale, which is right for `--no-discord` on a project
that HAS Discord, but wrong for a project that has none.) The Discord env file path becomes
configurable: `discordEnv: <path>` in the YAML, defaulting to `<repo-root>/tools/discord-setup/.env`.

**4. New flags, because the session-start hook needs speed.**
- `--from-cache` — render the page from the cached collections ONLY. No git, no gh, no ssh, no
  Discord. Must complete in well under a second. If there is no cache at all, say so readably and
  exit non-zero rather than rendering a lying empty page.
- `--summary` — print a COMPACT plain-text summary to stdout (and skip opening the browser): the
  derived decisions, one line each, plus one line per instance (`Prod 2.4.0`, `RC 2.4.0-rc.6 ⚠
  erwartet …`), plus the untriaged count. This text is injected into Claude's context at session
  start, so it must be short — target under 25 lines — and it must never print a secret or a host.
  Print roles and labels, never IPs or CT numbers.
- `--no-open` — build without launching a browser.
These compose: the hook will call `--from-cache --summary` (instant) and separately kick off a full
background refresh.

**5. `npm run roadmap` must keep working from inside a project.** Add a thin wrapper: running the
tool from any repo that has a `roadmap.local.yaml` should Just Work.

## What must NOT change

- `render(vm)` and `buildViewModel(input)` stay PURE.
- The page stays SELF-CONTAINED (inline CSS, no external asset, renders offline).
- Every user-supplied string stays HTML-escaped; every `href` keeps the http(s)-only `escUrl`
  allowlist. A Discord message body is attacker-influenced text.
- Collectors never throw; a failed one degrades to a marked-stale section, and the cache is
  refreshed ONLY by a successful collection.
- The deployment view stays **target-first**: one row per server, its running tag behind it. (The
  owner overruled a version-first proposal. Do not revert it.)
- The Unassigned column, the derived decisions, and the "closed issue = ausgeliefert" rule all stay.
- Page copy GERMAN; code, comments and commits ENGLISH.
- `any` forbidden; no `console.log`; Prettier printWidth 100, double quotes; async/await only.

## Tests

Keep all 85 green and add: `via: docker` builds an ssh+docker command with no `pct`; `via: proxmox`
without a `ct` is rejected; `via: docker` WITH a `ct` is rejected; a config with no `discord:`
section produces no Discord warning; `--from-cache` with an empty cache fails readably rather than
rendering an empty page.
