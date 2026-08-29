# TravStats Release & Update Workflow

Canonical release process: how a change goes from a dev branch to production,
via an RC that is first validated on a **prod-data mirror** before it is
promoted to prod. Prod only ever runs **final** tags — an RC never touches prod.

> **Terminology (3-tier, since 2026-07-04):** three non-prod roles, split so a
> hotfix RC can be validated without disturbing the forward feature line:
> - **Beta** — CT106 (`ct106-travstats-beta`, `<rc-hostname>`). Rolling home
>   of the **forward dev line** (`dev/vX.Y`, e.g. 2.3.0) and the external
>   Mobile-App testers. Its own persistent data — **never** prod-cloned.
> - **RC Server** — a dedicated CT, a **prod-data mirror**. Validates the
>   **imminent release** (any patch or the maturing minor) against real prod
>   data right before promote. Re-cloned from prod each round; ephemeral state.
> - **Prod** — CT100. Real users, **final tags only**, changed only on promote.
>
> This replaces the earlier single "RC Server = CT106" role, which collided with
> CT106's job as the external app-Beta (a prod clone would wipe beta-tester
> data, and one server can't stage a patch RC and the 2.3.0 beta at once).

## 1. Environments

| Stage | Host | Reachable | DB (container) | Role |
|---|---|---|---|---|
| **Local Dev** | dev machine | `8000` / `3000` | dev DB `:5433` (`flights_dev`) | Build, TDD, rehearse migrations |
| **Beta** | CT106 (pve-node3) | `<beta-host>:3010`, `<rc-hostname>` | `travstats-db-beta` | Forward dev line + external app testers; own persistent data, rolling |
| **Preview** | CT134 (pve-node1, DMZ) | `beta.travstats.de`, `immich-beta.…`, `poi-beta.…` | own, per slot | Public demo instances for external testers; demo data only, never a prod dump |
| **RC Server** | CT107 (pve-node3) `ct107-travstats-rc` | `<rc-host>:3010` | `travstats-db-rc` | **Prod-data mirror** — validate the imminent release before promote; re-cloned each round |
| **Prod** | CT100 (pve-node3, HA) | `<prod-host>:3010` | `travstats-db` (`flights`) | Real users; **final tags only**, on promote |
| **Web** | CT133 | `travstats.de` | — | Marketing/Wiki, `version.ts` kept in lockstep |
| **External** | Norbert (Unraid) | `<nas-host>:3080` | own | Third-party user, pulls final `:latest` only |

SSH into a CT via the Proxmox node: `ssh -i ~/.ssh/id_ed25519 root@<pve-node3> "pct exec <CT> -- <cmd>"`.

## 2. Version numbering (SemVer + RC)

```
   MAJOR . MINOR . PATCH  [ -rc.N ]
     │       │       │        │
     │       │       │        └─ release-candidate counter (one per staging round)
     │       │       └─ fix / chore / perf / deps      →  PATCH  (2.2.1 → 2.2.2)
     │       └─ feat (new features)                    →  MINOR  (2.2.x → 2.3.0)
     └─ breaking change / DB rework                    →  MAJOR  (2.x → 3.0.0)
```

### Tag strategy

| Tag | Where | Runs on | When | Immutable |
|---|---|---|---|---|
| `:X.Y.Z-beta.N` | GHCR (+ git tag + GH pre-release) | **Beta** (CT106) | forward dev line, early feature / app testing | yes |
| `:X.Y.Z-rc.N` | GHCR | **RC Server** (CT107) | imminent release, validated vs prod data | yes |
| `:X.Y.Z` `:latest` `:stable` | GHCR **+ Docker Hub** | **Prod** (CT100) | after promotion (byte-identical retag) | yes |
| `:rc-latest` | Docker Hub | — | rolling pointer to newest RC | no |

**Suffix convention:** `-beta.N` = "in development, on the Beta server for app/feature
testing"; `-rc.N` = "prod candidate, validated against prod data on the RC Server".
A maturing line rolls as `-beta.N` and only switches to `-rc.N` once it is the
*next-to-ship* release (no rebuild — just tag the next build `-rc`).

**Rule:** a final tag is never a fresh build — always a `docker buildx imagetools create`
retag of the exact RC image that was validated.

### Discord announce lanes (mirror the tiers)

`tools/discord-setup`: `announce beta` → `#beta-channel`, `announce rc` →
`#release-candidate`, `announce release` → `#announcements`. Draft first, post on
the user's OK.

## 3. The pipeline (stages 0–6)

```
 [0] dev/vX.Y ──gate──▶ [1] RC cut ──▶ [2] build GHCR :X.Y.Z-rc.1
                                                   │
                        ┌──────────────────────────┘
                        ▼
 [3] RC SERVER      ──▶ clone Prod data → RC-Server DB (dedicated prod-mirror CT)
     (prod mirror)      deploy :rc.N, migrate additively, UAT on real data
                        │
              ok? ──yes─┤        no → back to [0], cut rc.N+1, re-stage
                        ▼
 [4] PROMOTE        ──▶ retag rc → :X.Y.Z / :latest / :stable (byte-identical)
                        Docker Hub mirror
                        ▼
 [5] PROD           ──▶ deploy the FINAL tag to CT100 (never an :rc), health + UAT
     (CT100)
                        ▼
 [6] RELEASE        ──▶ /release (GH release --latest), bump Web version.ts,
                        external users pull :latest

 (parallel track)  Beta ──▶ forward dev line (dev/vX.Y) rolls onto CT106 for
     (CT106)               feature + Mobile-App testing; own data, not prod-cloned.
                           Promotes into [1]–[6] when that line becomes the
                           imminent release.
```

**Two key differences from the old flow:** (1) the RC is validated on a
**dedicated prod-mirror RC Server** — separate from the CT106 **Beta**, so a
hotfix RC never wipes beta-tester data or evicts the 2.3.0 beta. (2) **Prod is
promoted, not RC-deployed** — CT100 only ever runs a final tag. A broken
migration breaks on the mirror, never on prod.

## 4. Stage detail

**[0] Develop** — everything on the single dev branch `dev/vX.Y` (currently `dev/v2.3`).
`main` stays release-only (mirrors the current production release).

**[1] RC cut** — set `backend/VERSION`→`X.Y.Z`, write `CHANGELOG.md`, commit on the
dev branch, merge to `main`, git tag `vX.Y.Z-rc.N`, GitHub **Pre-release**
(`--prerelease`, never `--latest`). The `/deploy` skill automates the bump + changelog.

**[2] Build** — `docker build → GHCR :X.Y.Z-rc.N`. Mandatory gate first:
`cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
and `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`.

**[3] RC Server (the staging gate)** — the dedicated **prod-mirror** CT (NOT the
CT106 Beta).
1. **Clone Prod DB → RC-Server DB** so the RC runs against real data —
   `scripts/stage-rc-from-prod.sh`, no arguments needed. Its defaults target the
   RC Server, and it **refuses outright** to restore onto the CT106 Beta or onto
   Prod, whatever `CT_RC`/`DB_RC_CONTAINER` are set to. (Until 2026-08-05 those
   defaults still pointed at CT106 from the days when the beta box doubled as the
   RC target, so a correct run depended on the caller remembering the overrides.)
2. Deploy `:X.Y.Z-rc.N` to the RC Server; the container entrypoint runs
   `prisma migrate deploy`, lifting the prod data additively onto the new schema.
3. UAT against realistic data. **If a migration breaks here, it did NOT break prod.**
4. *(optional)* Add a known UAT login without using real prod credentials by running
   the compiled demo seed inside the RC container:
   `docker exec -w /app/backend <rc-app> node dist/seedDevAdmin.js` → `admin:admin123`
   with demo data (idempotent). The RC's `DATABASE_URL` already points at the RC DB.
   Note the prod image has no `tsx`, so run the compiled `dist/*.js`, not `npm run seed:*`.

**[4] Promote** (only on explicit "promote"/"final" command) — retag the
validated RC to `:X.Y.Z` / `:latest` / `:stable` (byte-identical), mirror to
Docker Hub. No rebuild — this is the gate between the RC Server and prod.

**[5] Prod** — deploy the **final** tag to CT100 (never an `:rc`), bump the
`APP_VERSION` env alongside it, run the health check (`/health`), do final UAT.

**[6] Release** — `/release` (GitHub release `--latest`), bump
`TravStatsWeb/src/data/version.ts` + redeploy the apex, external instances pull `:latest`.

## 5. Update tracks

| Kind | Version step | Path |
|---|---|---|
| **Feature release** | minor `2.2.x → 2.3.0` | full pipeline 0–6 |
| **Patch release** (bugfixes, deps) | patch `2.3.0 → 2.3.1` | full pipeline, batched |
| **Hotfix** (prod on fire) | patch, `fix/<slug>` off the release | express: RC → **short** RC-Server smoke → prod → promote |
| **Dependency updates** (Dependabot) | roll into next patch RC | test, fold into the next patch |

## 6. The "RC Server = copy of prod data" invariant

Every staging run (stage 3) starts the RC Server from fresh prod data. This keeps
the RC Server an honest prod mirror instead of drifting into its own state. Run:

```bash
scripts/stage-rc-from-prod.sh      # dump Prod DB → restore into RC-Server DB
# then deploy the RC image; its entrypoint's `prisma migrate deploy` lifts the
# prod data additively onto the new schema.
```

## 7. Concrete: shipping `2.3.0`

`dev/v2.3` holds the colors feature + Wave A stats + mobile-app server side
(pairing, app-settings, boarding-pass). Its first RC:

The 2.3.0 line lives on the **Beta** (CT106) for app/feature testing while it
matures. When it is the imminent release it enters the ship pipeline:

1. `[1]/[2]` cut + build `ghcr.io/abrechen2/travstats:2.3.0-rc.1`.
2. `[3]` `scripts/stage-rc-from-prod.sh` → deploy `:2.3.0-rc.1` to the **RC Server**
   (the prod-mirror CT, not the CT106 Beta); UAT on real data.
3. `[4]` on green UAT and your "promote", retag to `:2.3.0`/`:latest`/`:stable`
   (byte-identical) + Docker Hub mirror.
4. `[5]/[6]` deploy the **final** `:2.3.0` to Prod (CT100), then `/release`
   (GH `--latest`) + bump the Web `version.ts`.
