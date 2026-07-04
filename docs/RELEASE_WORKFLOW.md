# TravStats Release & Update Workflow

Canonical release process: how a change goes from a dev branch to production,
via an RC that is first validated on a **prod-data mirror** before it ever
touches prod. Supersedes the older "RC straight to prod" flow and the old
"beta server" terminology.

> **Terminology:** CT106 is the **RC Server** (formerly "beta server"). It
> runs release candidates against a copy of prod data — it is a staging
> mirror, not a separate beta track.

## 1. Environments

| Stage | Host | Reachable | DB (container) | Role |
|---|---|---|---|---|
| **Local Dev** | dev machine | `8000` / `3000` | dev DB `:5433` (`flights_dev`) | Build, TDD, rehearse migrations |
| **RC Server** | CT106 (pve-node3) | `192.168.178.123:3010` | `travstats-db-beta` (`flights`) | **Validate the RC against a copy of prod data** |
| **Prod** | CT100 (pve-node3, HA) | `192.168.178.120:3010` | `travstats-db` (`flights`) | Real users |
| **Web** | CT133 | `travstats.de` | — | Marketing/Wiki, `version.ts` kept in lockstep |
| **External** | Norbert (Unraid) | `192.168.178.202:3080` | own | Third-party user, pulls final `:latest` only |

SSH into a CT via the Proxmox node: `ssh -i ~/.ssh/id_ed25519 root@192.168.178.180 "pct exec <CT> -- <cmd>"`.

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

| Tag | Where | When | Immutable |
|---|---|---|---|
| `:X.Y.Z-rc.N` | GHCR | RC cut, every staging round | yes |
| `:X.Y.Z` `:latest` `:stable` | GHCR **+ Docker Hub** | after promotion (byte-identical retag) | yes |
| `:rc-latest` | Docker Hub | rolling pointer to newest RC | no |

**Rule:** a final tag is never a fresh build — always a `docker buildx imagetools create`
retag of the exact RC image that was validated.

## 3. The pipeline (stages 0–6)

```
 [0] dev/vX.Y ──gate──▶ [1] RC cut ──▶ [2] build GHCR :X.Y.Z-rc.1
                                                   │
                        ┌──────────────────────────┘
                        ▼
 [3] RC SERVER      ──▶ clone Prod data → RC-Server DB
     (CT106)            deploy :rc.N, migrate additively, UAT on real data
                        │
              ok? ──yes─┤        no → back to [0], cut rc.N+1, re-stage
                        ▼
 [4] PROD           ──▶ deploy the SAME :rc.N image to CT100, health + user UAT
     (CT100)
                        │
              ok? ──yes─┤        no → back to [0], cut rc.N+1
                        ▼
 [5] PROMOTE        ──▶ retag rc → :X.Y.Z / :latest / :stable (byte-identical)
                        Docker Hub mirror
                        ▼
 [6] RELEASE        ──▶ /release (GH release --latest), bump Web version.ts,
                        external users pull :latest
```

**Key difference from the old flow:** the RC lands on the **RC Server first**
(against a copy of prod data), and only then on prod. Migrations that break do
so on the mirror, never on prod.

## 4. Stage detail

**[0] Develop** — everything on the single dev branch `dev/vX.Y` (currently `dev/v2.3`).
`main` stays release-only (mirrors the current production release).

**[1] RC cut** — set `backend/VERSION`→`X.Y.Z`, write `CHANGELOG.md`, commit on the
dev branch, merge to `main`, git tag `vX.Y.Z-rc.N`, GitHub **Pre-release**
(`--prerelease`, never `--latest`). The `/deploy` skill automates the bump + changelog.

**[2] Build** — `docker build → GHCR :X.Y.Z-rc.N`. Mandatory gate first:
`cd backend && npx tsc --noEmit && npm run lint && npm test -- --forceExit`
and `cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run`.

**[3] RC Server (the staging gate)** —
1. **Clone Prod DB → RC-Server DB** so the RC runs against real data
   (`scripts/stage-rc-from-prod.sh`).
2. Deploy `:X.Y.Z-rc.N` to CT106; the container entrypoint runs
   `prisma migrate deploy`, lifting the prod data additively onto the new schema.
3. UAT against realistic data. **If a migration breaks here, it did NOT break prod.**
4. *(optional)* Add a known UAT login without using real prod credentials by running
   the compiled demo seed inside the RC container:
   `docker exec -w /app/backend <rc-app> node dist/seedDevAdmin.js` → `admin:admin123`
   with demo data (idempotent). The RC's `DATABASE_URL` already points at the RC DB.
   Note the prod image has no `tsx`, so run the compiled `dist/*.js`, not `npm run seed:*`.

**[4] Prod** — deploy the *same* validated `:rc.N` image to CT100, bump the
`APP_VERSION` env alongside it, run the health check (`/health`), do final UAT.

**[5] Promote** (only on explicit "promote"/"final" command) — retag the RC to
`:X.Y.Z` / `:latest` / `:stable` (byte-identical), mirror to Docker Hub.

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

1. `[1]/[2]` cut + build `ghcr.io/abrechen2/travstats:2.3.0-rc.1`.
2. `[3]` `scripts/stage-rc-from-prod.sh`, then deploy `:2.3.0-rc.1` to the RC Server (CT106).
3. `[4]` on green UAT, deploy the same image to Prod (CT100).
4. `[5]/[6]` on your "promote", retag to `:2.3.0`/`:latest`/`:stable`, mirror, release.
