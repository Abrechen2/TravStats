# Internal Roadmap Board — Design

**Date:** 2026-07-13
**Status:** approved (owner, 2026-07-13)
**Branch:** `feat/roadmap-board`

## Problem

Work in flight is tracked in five places that never agree: GitHub issues, Discord
threads, `ROADMAP.local.md` (394 lines of prose), the git branch/worktree layout,
and the images actually running on six deployment targets. Nothing joins them.

The concrete failure this causes: three finished, unmerged feature lines
(Immich, airline-logo/table, lodging) and thirteen already-fixed issues were all
queued behind a single un-promoted release, and that was not visible anywhere —
the owner lost the overview. A promise made in a Discord thread ("hide the dead
TravStats-export re-import in the next RC") exists in no ticket and no roadmap
at all.

## Goal

One locally-generated, read-only HTML page that answers, in order:

1. **What decision is blocking what?** — derived, not hand-maintained.
2. **What version runs where?** — live from the deployment targets.
3. **What belongs to which release?** — issues, Discord topics and audit findings
   as cards under a version.
4. **What is unassigned?** — every open issue that no version claims, so nothing
   can be silently lost again.

## Non-goals

- No write-back. The page never mutates issues, branches or the roadmap file.
- No actions (promote, deploy, close). Those stay in the existing skills.
- No hosting. The page is generated and opened locally; it is never published.

## Architecture

A Node script under `tools/roadmap/` (TypeScript, `tsx`, mirroring the layout of
`tools/discord-setup/`). One command:

```bash
npm run roadmap            # collect → render → open
npm run roadmap -- --no-ssh   # skip the deployment probe (offline / fast)
```

Three stages, isolated so each can be tested alone:

| Stage | Module | Responsibility |
|---|---|---|
| Collect | `src/collectors/*.ts` | One collector per source. Each returns typed data or a typed failure. Never throws. |
| Merge | `src/model.ts` | Joins the curated layer with the live layer into one view model. Pure function — no I/O. |
| Render | `src/render.ts` | View model → self-contained HTML string. Pure function. |

`src/index.ts` wires them: collect (in parallel), merge, render, write, open.

### Two data layers

The curated layer holds only what requires judgement. Everything mechanical is
read live at each run, so it can never drift.

**Live (collected every run):**

| Collector | Source | Yields |
|---|---|---|
| `git.ts` | `git` (local) | branches, worktrees, commits ahead/behind `main`, tags |
| `github.ts` | `gh` CLI | open issues (number, title, state, labels, author), open Dependabot PRs, releases |
| `deployments.ts` | `ssh` → Proxmox `pct exec` → `docker inspect` | the image tag running on each instance |
| `discord.ts` | the existing `tools/discord-setup` bot | messages in the watched channels newer than the per-channel triage watermark |

**Curated (`roadmap.local.yaml`, gitignored):**

```yaml
instances:                      # host/CT wiring lives here, NOT in committed code
  - id: prod
    label: Prod
    node: <pve-host>            # values come from CLAUDE.local.md
    ct: 100
    container: TravStats
    role: production

discord:                        # per-channel triage watermark
  - channel: dev-talk
    triagedUpTo: "2026-07-12T16:42:30Z"
  - channel: beta-channel
    triagedUpTo: "2026-07-10T10:24:53Z"

versions:
  - id: "2.4.0"
    state: rc                   # released | rc | awaiting-merge | planned
    branch: main                # the branch this version is assembled on
    note: |
      Markdown. Rendered in the version's detail panel.

items:
  - id: gh-197
    source: { type: github, ref: 197 }   # github | discord | audit | owner
    version: "2.4.0"
    status: fixed-awaiting-release       # planned | active | blocked | parked |
                                         # fixed-awaiting-release | done
    branch: main
    notes: |
      Markdown. The long-form post-mortems from ROADMAP.local.md live here.
```

A `github`-sourced item carries **no title** — the title, state and labels come
from the live collector, keyed by issue number. Titles are never transcribed.
`discord` / `audit` / `owner` items have no live anchor and therefore carry a
`title` field.

### The derived "Now" zone

Zone 1 is computed from the merged model, never authored. Rules, in priority
order:

1. A version with `state: awaiting-merge` whose `branch` is unmerged into `main`
   (the git collector reports the ahead-count) → a pending **merge/release
   decision**, with the issues that ride along listed under it.
2. Items with `status: fixed-awaiting-release` grouped by version → "promoting
   X closes N issues".
3. Items with `status: blocked` → the blocker is named.
4. Discord messages newer than their channel's watermark → "N untriaged".

If the rules produce nothing, the zone says so rather than rendering empty.

### Discord triage

A GitHub issue is one item. A Discord message is not: a single post from a tester
routinely carries half a dozen distinct asks, and a machine that turns one message
into one card buries five of them. So the tool does **not** convert messages into
items.

Instead it surfaces them. Every message newer than its channel's `triagedUpTo`
watermark is listed verbatim — author, timestamp, full text, jump link — under an
**Untriaged** heading. The page therefore never claims to know more than it does.

Triage itself is an agent step, invoked on the owner's command: read the untriaged
messages, split each into discrete items, propose a version and status for each,
**present the proposal, and write to `roadmap.local.yaml` only after the owner
approves**. The watermark advances only on a write. An unapproved triage leaves
the state untouched, so nothing is half-ingested.

Watermarks are per channel, not global: the channels are read at different
cadences and a single global cursor would mark an unread channel as triaged.

### Page zones

1. **Jetzt dran** — the derived decisions above.
2. **Instances** — one tile per deployment target: role, CT, running image tag,
   and whether it matches the version the roadmap expects there.
3. **Version board** — one column per version plus `Backlog` and
   **`Unassigned`**. Cards carry source badge, status, issue link. Clicking a
   card opens its `notes`. Filters: source, status.
4. **Ledger** — branches/worktrees with ahead-counts, open Dependabot PRs,
   maintenance items.

The `Unassigned` column is the anti-drift feature: any open GitHub issue whose
number appears in no item is listed there automatically.

## Failure modes

Every collector fails soft, because a broken SSH hop must not cost the whole
page:

- Each collector returns `{ ok: true, data } | { ok: false, reason }`.
- The renderer marks a failed section explicitly ("Instances: unreachable,
  showing cached state from <timestamp>") rather than omitting it or, worse,
  rendering a stale value as if it were fresh.
- The last successful collection is cached to `.roadmap/cache.json` and used as
  the fallback. A cache older than 24 h is shown with a warning.
- SSH probes get a hard timeout (8 s each, run in parallel).

## Security and repository hygiene

Two `.gitignore` traps, both verified before the tool is written:

1. `tools/*` is ignored wholesale, with `!tools/discord-setup/` as the only
   exception. `tools/roadmap/` therefore needs an explicit `!tools/roadmap/`
   whitelist or the committed tool is invisible.
2. The `*.md` rule ignores markdown by default, which is why `ROADMAP.local.md`
   stays internal. A `.yaml` file is **not** covered by it. `roadmap.local.yaml`
   and the generated `.roadmap/` output directory need explicit ignore entries.

Both must be proven with `git check-ignore -v <path>` (non-empty output = ignored)
and with `git status` showing the files as untracked-and-ignored, not merely
unstaged.

The committed tool code contains **no hostnames, IPs, CT numbers or container
names** — all of that lives in the gitignored `roadmap.local.yaml`, sourced from
`CLAUDE.local.md`. The repository is public; the roadmap content is not.

## Migration

`ROADMAP.local.md` is ported once into `roadmap.local.yaml`: table rows become
items, the narrative sections ("the #186 chain", "the colour-mode redesign")
become `notes` on the item or `note` on the version they belong to. Nothing is
discarded. The old file is kept as `ROADMAP.local.md.archive` until the board has
been used for one release cycle, then deleted.

## Testing

- **Unit** — the merge function against fixture inputs: an issue in no item lands
  in `Unassigned`; a `fixed-awaiting-release` group produces the promote decision;
  a failed collector produces a marked-stale section rather than a missing one.
- **Unit** — the YAML loader rejects an item with an unknown `status`, an unknown
  `version`, or a `github` source with a hand-written `title` (that is the drift
  the design exists to prevent).
- **Snapshot** — render a fixture model to HTML and assert the four zones exist.
- No E2E. The page has no behaviour beyond filters and disclosure.

## Maintenance

`roadmap.local.yaml` is updated at the end of a work session, alongside the
existing memory/ledger step — the same discipline, one file instead of prose.
Because titles, states, branch positions and running versions are all live, the
only thing that can go stale is the *judgement* layer, which is exactly the part
that needs a human (or an agent) to think about it anyway.
