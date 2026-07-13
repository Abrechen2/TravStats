# Roadmap board

Generates `<repo-root>/.roadmap/index.html` — one page joining the curated
roadmap (`roadmap.local.yaml`) with live data from git, GitHub, Discord and
the images actually running on the deployment targets.

## Setup

1. `npm install` in this directory.
2. Copy `roadmap.local.example.yaml` to `<repo-root>/roadmap.local.yaml` and
   fill in the real instances (hosts, CT numbers, container names) from
   `CLAUDE.local.md`. **`roadmap.local.yaml` is gitignored — never commit it,
   and never put real hosts/IPs into the example file, which IS committed.**
3. Discord reads reuse the existing bot credentials at
   `tools/discord-setup/.env` (bot token + guild id).
4. GitHub reads use the `gh` CLI — run `gh auth status` if issues/PRs are
   missing from the page.

## Use

```bash
npm run roadmap                  # from the repo root
npm run roadmap -- --no-ssh      # skip the deployment probe (offline / fast)
npm run roadmap -- --no-discord  # skip the Discord fetch
```

The tool writes `<repo-root>/.roadmap/index.html` and opens it in the default
browser. It resolves the repo root from its own file location, not from the
current working directory, so it also works if invoked directly from inside
`tools/roadmap` (e.g. `npm start`) instead of via the root script.

If `<repo-root>/roadmap.local.yaml` does not exist yet, the tool exits with a
short, readable message pointing at `roadmap.local.example.yaml` — not a
stack trace.

## Failure behaviour

Every collector (git, GitHub, deployments, Discord) reports a typed failure
instead of throwing, so one dead source never costs the whole page:

- A failed collector falls back to the **last successfully cached state** for
  that section and marks it stale (with the timestamp it was collected and
  the reason it fell back) both in a console warning and at the top of the
  generated page.
- **The cache is refreshed only by a successful collection.** A failed
  collector never overwrites good cached data with an empty result — one bad
  SSH hop can never turn into permanent amnesia for that section.
- `--no-ssh` and `--no-discord` produce the exact same marked-stale path as a
  genuine failure (falls back to cache, shows a warning) — never a silent
  empty section.
- If a section has never been collected successfully (no cache either), it
  renders empty and says so; it never fabricates data.

## Discord triage

Untriaged Discord messages (anything newer than a channel's `triagedUpTo`
watermark in `roadmap.local.yaml`) are listed verbatim on the page — the tool
never turns them into roadmap items itself. One tester message routinely
carries several distinct asks, and splitting it into items is a judgement
call, not parsing: ask Claude to triage on the owner's command, review the
proposed split, and only once it is approved does the watermark advance.

## Verify

```bash
cd tools/roadmap
npm run typecheck   # tsc --noEmit, expect exit 0 with no output
npm test            # vitest --run, expect all tests green
```

Both are cheap, offline and required before committing any change to this
tool — they do not need a running Discord bot, SSH access, or `gh auth`.
