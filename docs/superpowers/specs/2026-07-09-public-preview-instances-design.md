# Public Preview Instances — Design

**Date:** 2026-07-09
**Status:** Approved, not implemented
**Scope:** New DMZ host serving three publicly reachable, demo-only TravStats
instances for external testers.

## 1. Context

External collaborators (currently Alexander Künzel) have no way to try a
feature before it ships. Feature work lives on long-running dev branches in
git worktrees (`dev/immich-albums`, `dev/hotels`) and is never deployed
anywhere. The only running non-prod instances are inside the secure LAN:

| CT | Role | Address | Data |
|---|---|---|---|
| 100 | Prod | `192.168.178.120:3010` | real users |
| 106 | Beta (forward dev line, app testers) | `192.168.178.123:3010`, `trav.abrechen2.de` | persistent beta data |
| 107 | RC Server (prod-data mirror) | `192.168.178.187:3010` | re-cloned from prod each round |

None of these may host strangers. This design adds a fourth, **separate** host
outside the LAN. It does not modify CT100, CT106 or CT107 in any way.

## 2. Goals

- Three publicly reachable instances: one tracking the forward dev line, one
  per active feature worktree.
- Demo data only. No prod dump ever reaches this host.
- Deployment reuses the existing build pipeline — no new image build path.
- The DMZ's network isolation from the LAN stays intact.

## 3. Non-goals

- Replacing or re-pointing `trav.abrechen2.de` (CT106 keeps its current role).
- Auto-deploy on push. Deploys are explicit, on request.
- Prod-representative LLM parse quality (see §7).
- Scheduled data resets. Instance data persists until manually cleaned.

## 4. Host

New unprivileged LXC **CT 134** on **pve-node1** — the only node carrying the
`vmbr2` bridge (`192.168.20.171/24`, `bridge-ports nic0.20`, gateway
`192.168.20.1`). VMID 134 is free; it was released when `travstats-wiki` was
destroyed on 2026-05-02.

| Setting | Value |
|---|---|
| Hostname | `ct134-travstats-preview` |
| Node | pve-node1 (pinned — `vmbr2` exists nowhere else) |
| Network | `vmbr2`, static `192.168.20.134/24`, gw `192.168.20.1` |
| Resources | 4 cores, 8 GB RAM, 30 GB `ceph-nvme` |
| Features | unprivileged, `nesting=1` |
| Docker | `get.docker.com` convenience script |
| Base | Debian 12 |

pve-node1 has 21 GB RAM available of 32 GB, and `ceph-nvme` has 807 GB free.
The host is not HA-migratable, matching CT133's existing constraint.

## 5. Stacks

Four containers. Each preview gets its own Postgres so that a failed migration
on one branch cannot take down the others. Ollama is shared because the model
weights dominate the memory budget.

```
/opt/preview/ollama/    ollama:11434  (gemma3:4b, CPU)   — docker network only
/opt/preview/beta/      app :3010 + postgis  →  beta.travstats.de
/opt/preview/immich/    app :3011 + postgis  →  immich-beta.travstats.de
/opt/preview/poi/       app :3012 + postgis  →  poi-beta.travstats.de
cloudflared (systemd)   one tunnel, three public hostnames
```

Each `docker-compose.yml` derives from the CT106 beta compose, with these
deltas:

| Env | CT106 | Preview |
|---|---|---|
| `OLLAMA_URL` | `http://192.168.178.155:11434` | `http://ollama:11434` |
| `OLLAMA_MODEL` | `gemma3:12b` | `gemma3:4b` |
| `POSTGRES_PASSWORD` | `flights` | generated per stack |
| `FRONTEND_URL` | CT106 IP | the public hostname |

`ALLOW_REGISTRATION=false`, `CREATE_DEMO_USER=false`, `SEED_AIRPORTS=false`
and `TZ=UTC` carry over unchanged. Postgres ports are not published.

Ollama joins each stack via an external Docker network so the three app
containers resolve `ollama` by name without the stacks sharing a compose file.

## 6. DNS and TLS

Cloudflare Universal SSL covers `travstats.de` and `*.travstats.de` — **one
subdomain level only**. A hostname such as `immich.beta.travstats.de` sits one
level deeper and would receive no edge certificate, producing a TLS error for
every visitor. Advanced Certificate Manager would fix it at roughly $10/month,
which is disproportionate for three test instances.

Hostnames are therefore flat:

| Hostname | Slot | Source branch |
|---|---|---|
| `beta.travstats.de` | `beta` | `dev/v2.3` (forward line) |
| `immich-beta.travstats.de` | `immich` | `dev/immich-albums` |
| `poi-beta.travstats.de` | `poi` | `dev/hotels` |

One `cloudflared` tunnel on CT134 with three public hostnames, each mapping to
`http://localhost:<port>`. This mirrors CT133's setup.

### Verified Cloudflare state (2026-07-09)

| Fact | Value |
|---|---|
| Zone `travstats.de` | `8e34d30898073f3ee7e95bc0bdcb4022` |
| Account | `9a4d9c86ff53f151156fc1361af434cf` ("Abrechen2 Account") |
| Existing records | apex + `www` (CNAME → `ddd96c4a-…cfargotunnel.com`), one TXT |
| `beta`, `immich-beta`, `poi-beta` | free, no collision |

The API token lives at `~/.cloudflare-travstats-token` (`chmod 600`), never in
the repo. Probed capability: DNS read **and** write confirmed (a throwaway TXT
record was created and deleted); Cloudflare Tunnel read/write **denied** (401
on direct tunnel fetch; the list endpoint silently returns an empty result
rather than 403, which is misleading — do not read an empty tunnel list as
"no tunnels exist").

The token therefore needs `Account → Cloudflare Tunnel → Edit` added before
provisioning can create the tunnel. Until then the tunnel must be created by
hand in the dashboard and its token handed to CT134.

The token's grants are all **zone-level** (`DNS Write`, `Zone Write`, `SSL and
Certificates Write`, …). `Cloudflare Tunnel` is an **account-level**
permission and is absent — that, not an insufficient zone scope, is why tunnel
calls 401. The fix is to add `Account → Cloudflare Tunnel → Edit` under
*Account Resources*.

The token also carries an **IP allowlist pinned to `87.138.182.241`**, which is
currently the dev machine's WAN address. That address is dynamic — CT121 runs
`cloudflare-ddns` precisely because it changes. After the next reconnect the
token will fail, and it will fail *looking like a permissions error*. Either
widen the allowlist or expect to re-pin it.

Note: `/user/tokens/verify` returns 401 for account-scoped tokens (`cfat_`
prefix) even when they are valid. It is not a usable liveness probe here; hit
a real endpoint instead. Likewise, the `cfd_tunnel` **list** endpoint returns
`200` with an empty result when the token lacks tunnel permission — it does
not return 403. An empty tunnel list never means "no tunnels exist".

## 7. LLM parser

> **STATUS 2026-07-09 — DISABLED IN PRODUCTION.** The shared Ollama below was
> built and worked, but on pve-node1 (a shared Ceph/KVM cluster node) a booking
> parse measured **0.3 tokens/second** — every call exceeded the timeout and
> fell back to the regex templates anyway, while pegging cores. The Ollama
> container, model and volume were removed from CT134 and `USE_LLM_PARSER` set
> to `false` on all three slots. Known airlines still parse instantly via
> templates. The rest of this section documents the original design; re-enable
> it only if the previews move to dedicated hardware (see §12 risk row).

The DMZ has no route to the LAN, so the Mac mini's Ollama at
`192.168.178.155:11434` is unreachable. Rather than punching a hole in exactly
the isolation that makes public exposure acceptable, CT134 runs its own Ollama
with `gemma3:4b` on CPU.

**Consequence, and it is not cosmetic:** `gemma3:4b` is not `gemma3:12b`. Parse
quality on the previews is not representative of production. A parser failure
observed on a preview may be a model artifact rather than a code defect, and a
parser success there does not certify the prod path. **Any parser bug reported
against a preview must be reproduced on CT106 before it is filed.**

`services/ollamaVisionParser.ts` reads `OLLAMA_URL` from the environment only,
so the vision path follows automatically. `services/cruiseBookingParser.ts`
resolves `options > admin_settings > env > default`, so the admin UI can
override the model per instance if a specific test needs it.

## 8. Accounts and data

Seeded per instance via `seedDemoUser()`:

| Account | Purpose |
|---|---|
| `demo` | shared, for anyone following a link |
| `alex` | named tester account |
| `claude` | for driving the UI in end-to-end checks |

Registration is disabled twice: `ALLOW_REGISTRATION=false` as the bootstrap
env var, and `allowRegistration=false` in the instance settings, which is what
`routes/auth.ts` actually consults at runtime.

**Closing registration is not enough — there are two doors.** `/auth/register`
is one; `/api/v1/setup/initialize` is the other, and it creates an *admin*. It
is guarded by `adminCount > 0`, not `userCount > 0`, so seeding only non-admin
users leaves it wide open: any public visitor can POST themselves an admin
account. The seed therefore MUST create at least one admin per slot so
`adminCount > 0`. Verified closed: `setup/initialize` returns 400 on all three
public hosts. (Found the hard way during implementation — a verification probe
created live admin accounts before the guard was understood.)

Data persists — no scheduled reset. This is a deliberate trade: a tester can
stay on a bug across days, at the cost of drift and eventual manual cleanup.
CT106 is the cautionary example, having accumulated 523 flights against prod's
400.

`scripts/stage-rc-from-prod.sh` must never target CT134. The script is
destructive and clones prod data; on a public host that would be a breach.

## 9. Deploy

No new build pipeline. `scripts/deploy-preview.sh <slot> <tag>` takes an image
tag that **already exists on GHCR**, writes it into the slot's compose file,
pulls, restarts, and health-checks the public URL.

- **`beta` slot** — fed by the `:X.Y.Z-beta.N` image that `/deploy beta`
  already builds and pushes. Deploying it to CT134 becomes an additional,
  on-request target after the existing CT106 step. The existing
  `npm run announce beta` embed covers it; the announcement links the public
  URL.
- **`immich` / `poi` slots** — these branches cut no `-beta.N` version. They
  use mutable tags `:preview-immich` and `:preview-poi`, built locally from
  the worktree and pushed to GHCR. Mutable is intentional: the tag means
  "whatever is currently on that branch", not a fixed artifact.

This keeps the `CLAUDE.local.md` rule that no image is built by GitHub Actions.

## 10. Security posture

- The host runs unreleased code and is reachable from the internet. It sits in
  VLAN 20, which has no route into the homelab LAN. That containment is the
  entire reason the arrangement is acceptable, and §7 exists to preserve it.
- No secrets of value live on CT134: no prod DB credentials, no LAN API keys,
  no flight-provider keys. Generated Postgres passwords are per-stack and
  worthless outside the host.
- Registration is closed, so the public attack surface is the login form and
  the unauthenticated airport-search endpoint, both already rate-limited.
- Cloudflare fronts every hostname, so the origin IP is never exposed.

## 11. Verification

Provisioning is done when, for each of the three hostnames:

1. `curl -sI https://<host>` returns `200`.
2. `curl -s https://<host>/health` reports healthy.
3. Logging in as `demo` reaches the dashboard.
4. The map renders (this is the check that catches broken deploys; `/health`
   passes even when the frontend bundle is wrong).
5. `pct exec 134 -- docker exec <stack>-db psql -c 'select 1'` succeeds while
   no Postgres port is published to the host.

Additionally, from inside CT134: `curl --max-time 5 http://192.168.178.155:11434`
must **fail**. If it succeeds, the DMZ isolation is broken and the design's
core assumption is void.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Parse results mislead (4b vs 12b) | §7 rule: reproduce on CT106 before filing |
| Instances drift and rot | Accepted; manual cleanup, revisit if painful |
| pve-node1 is a single point of failure | Accepted; CT133 already has this property |
| LXC shares pve-node1's kernel: a Docker escape plus an LXC escape puts public pre-release code on a LAN host with Ceph | **Accepted by the owner, 2026-07-09**, after being offered a KVM VM (own kernel, 0 EUR) and a dedicated mini-PC. Rationale: the network path is measured shut (CT134 reaches neither prod, node3, the beta, nor the LAN Ollama), the data is fake, and two independent escapes are required. Revisit if the previews ever hold real data or if a Docker/LXC escape CVE lands. |
| Mutable `:preview-*` tags make "what is deployed?" ambiguous | Health endpoint reports the version; announce posts the commit |
| A preview leaks a real user's data | Impossible by construction — no prod dump, demo seed only |

## 13. Credential hygiene — mandatory follow-up

Two secrets were exposed in the chat transcript during design (2026-07-09) and
must be rotated once provisioning is complete. This is not optional and is the
final task of the implementation plan.

| Secret | Where | Action |
|---|---|---|
| Cloudflare token #3 (`cfat_igBB…`) — **the active one**, DNS + Tunnel | pasted in chat; `~/.cloudflare-travstats-token` | revoke after provisioning, reissue |
| Cloudflare token #2 (`cfat_oiZ3…`) — Tunnel only, superseded | pasted in chat | revoke now, unused |
| Cloudflare token #1 (`cfat_Syo…`) — DNS only, superseded | pasted in chat | revoke now, unused |
| Cloudflare DDNS `API_KEY` (zone `abrechen2.de`) | plaintext in `/opt/cloudflare-ddns/docker-compose.yml` on CT121 | revoke, reissue as a scoped token, move out of the compose file into an env file with `0600` |

Tokens #1 and #2 are already superseded and can be revoked immediately — they
grant real access and nothing depends on them.

A further string (`cfk_…`) was also pasted; it authenticates but is refused
(403) on the `travstats.de` zone. Its origin is unknown. If it is a live
credential for any service, it is compromised and needs rotation too.

All three `cfat_` tokens carry an IP allowlist pinned to a dynamic WAN address
(see §6). The reissued token should either widen that allowlist or be treated
as something that will need re-pinning.

The DDNS key predates this work and is not caused by it, but it is the more
serious of the two: it sits unencrypted on a running container.

## 14. Open question, tracked separately

The remark that "prod gets this address starting with 2.3" is unresolved and
does not affect this design. Prod currently has no public hostname. Before the
2.3 release we need to establish which hostname prod is meant to receive and
whether a LAN-resident prod should be publicly reachable at all — that is a
larger decision than three demo instances and gets its own discussion.

Separately, `CCProxmox/CLAUDE.md` lists CT101 (`sublarr`) and CT131
(`sublarr-wiki-public`), neither of which exists in the cluster. Documentation
drift, out of scope here, worth fixing.

Consistent with that, the Cloudflare account holds a `sublarr-wiki` tunnel
(`38121002-…`) in state `down` — the tunnel for the container that no longer
exists. Harmless, but it should be deleted along with the doc fix. The account's
other tunnels (`sublarr-prod`, `travstats-web`) are `healthy` and in use.
