# Public Preview Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up three publicly reachable, demo-only TravStats instances on a new DMZ container so external testers can try features before they ship.

**Architecture:** One unprivileged LXC (CT134) on pve-node1's `vmbr2` DMZ bridge runs three independent `docker compose` stacks — each an app container plus its own PostGIS — behind a single `cloudflared` tunnel with three flat hostnames. A fourth container serves a local Ollama so the DMZ never needs a route into the LAN. Deploys consume image tags that already exist on GHCR; nothing is built on the preview host.

**Tech Stack:** Proxmox LXC (Debian 12.12), Docker Compose, PostGIS 15-3.4, Ollama (`gemma3:4b`), cloudflared (token-mode), Cloudflare API v4, bash.

**Spec:** `docs/superpowers/specs/2026-07-09-public-preview-instances-design.md`

## Global Constraints

- **CT100, CT106 and CT107 are never touched.** No command in this plan may target them except read-only inspection.
- **`scripts/stage-rc-from-prod.sh` must never target CT134.** It is destructive and clones prod data.
- **CT134 lives on pve-node1 only.** `vmbr2` exists on no other node; do not enable HA migration.
- **Never build an image on CT134.** Deploys pull pre-built tags from GHCR (`CLAUDE.local.md`: no GitHub Actions build; images are built locally and pushed).
- **No secrets in the repo.** Cloudflare token stays at `~/.cloudflare-travstats-token` (`chmod 600`). Generated Postgres passwords live in `/opt/preview/<slot>/.env` on CT134 (`chmod 600`) and nowhere else.
- **Preview parse quality is not prod-representative.** `gemma3:4b` ≠ `gemma3:12b`. A parser bug seen on a preview must be reproduced on CT106 before it is filed as an issue.
- **Registration stays off** on every preview: `ALLOW_REGISTRATION=false` (env bootstrap) **and** `allowRegistration=false` in instance settings (what `routes/auth.ts` reads at runtime).
- **Cloudflare probe pitfalls:** `/user/tokens/verify` returns 401 for `cfat_` account-scoped tokens even when valid. The `cfd_tunnel` **list** endpoint returns `200` with an empty result when the token lacks tunnel permission — never read an empty list as "no tunnels exist". Probe with a real endpoint.

**Verified constants (do not re-derive):**

| Name | Value |
|---|---|
| Cloudflare zone `travstats.de` | `8e34d30898073f3ee7e95bc0bdcb4022` |
| Cloudflare account | `9a4d9c86ff53f151156fc1361af434cf` |
| Token file | `~/.cloudflare-travstats-token` (DNS + Tunnel verified) |
| pve-node1 | `192.168.178.171` |
| pve-node3 (for CT100/106/107 reads) | `192.168.178.180` |
| DMZ bridge | `vmbr2`, gateway `192.168.20.1` |
| CT134 address | `192.168.20.134/24` |
| LXC template | `local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst` |
| Ollama in LAN (must stay unreachable) | `192.168.178.155:11434` |
| Backend seed module inside the image | `/app/backend/dist/seedDemoUser.js`, exports `seedDemoUser` |

**Slot table (used by every task):**

| Slot | Host port | Hostname | Image tag | Source branch |
|---|---|---|---|---|
| `beta` | 3010 | `beta.travstats.de` | `:X.Y.Z-beta.N` (already on GHCR) | `dev/v2.3` |
| `immich` | 3011 | `immich-beta.travstats.de` | `:preview-immich` (mutable) | `dev/immich-albums` |
| `poi` | 3012 | `poi-beta.travstats.de` | `:preview-poi` (mutable) | `dev/hotels` |

**SSH pattern:** `ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c '<cmd>'"`

---

### Task 1: Provision CT134 and prove DMZ isolation

The isolation check is the whole justification for this host. If it fails, stop — the design's core assumption is void and the Ollama decision (Task 2) must be revisited.

**Files:**
- Create: `scripts/preview/provision-ct134.sh`

**Interfaces:**
- Produces: a running CT134 with Docker, reachable at `192.168.20.134`, and an external Docker network `preview-net`.

- [ ] **Step 1: Write the provisioning script**

Create `scripts/preview/provision-ct134.sh`:

```bash
#!/usr/bin/env bash
# Provision CT134 — public preview host in the DMZ (VLAN 20).
# Idempotent: safe to re-run. Never run against any other CTID.
set -euo pipefail

NODE1="${NODE1:-192.168.178.171}"
CTID=134
SSH=(ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}")

if [[ "$CTID" != "134" ]]; then
  echo "refusing: this script only provisions CT134" >&2
  exit 1
fi

if "${SSH[@]}" "pct status $CTID" >/dev/null 2>&1; then
  echo "CT$CTID already exists — skipping create"
else
  "${SSH[@]}" "pct create $CTID local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst \
      --hostname ct134-travstats-preview \
      --cores 4 --memory 8192 --swap 2048 \
      --rootfs ceph-nvme:30 \
      --net0 name=eth0,bridge=vmbr2,ip=192.168.20.134/24,gw=192.168.20.1 \
      --unprivileged 1 --features nesting=1 \
      --onboot 1 --start 1"
fi

"${SSH[@]}" "pct exec $CTID -- bash -c '
  set -e
  command -v docker >/dev/null 2>&1 || {
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates
    curl -fsSL https://get.docker.com | sh
  }
  docker network inspect preview-net >/dev/null 2>&1 || docker network create preview-net
  mkdir -p /opt/preview/{ollama,beta,immich,poi}
'"

echo "CT$CTID provisioned."
```

- [ ] **Step 2: Run it**

```bash
bash scripts/preview/provision-ct134.sh
```

Expected: `CT134 provisioned.` On a second run, `CT134 already exists — skipping create`.

- [ ] **Step 3: Verify Docker and the network exist**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- bash -c 'docker --version && docker network ls | grep preview-net'"
```

Expected: a Docker version line and a `preview-net` row.

- [ ] **Step 4: The negative test — LAN must be unreachable**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- bash -c 'curl -s --max-time 5 http://192.168.178.155:11434/ >/dev/null && echo REACHABLE || echo BLOCKED'"
```

Expected: `BLOCKED`.

**If this prints `REACHABLE`, stop and report.** The DMZ is not isolated from the LAN, the spec's §7 rationale collapses, and every later task is built on a false premise.

- [ ] **Step 5: Commit**

```bash
git add scripts/preview/provision-ct134.sh
git commit -m "feat(preview): provision script for CT134 DMZ host"
```

---

### Task 2: Shared Ollama in the DMZ

**Files:**
- Create: `scripts/preview/stacks/ollama/docker-compose.yml` (deployed to `/opt/preview/ollama/`)

**Interfaces:**
- Consumes: `preview-net` from Task 1.
- Produces: hostname `ollama` resolvable on `preview-net`, serving `gemma3:4b` on port `11434`. Not published to the CT's host interface.

- [ ] **Step 1: Write the compose file**

Create `scripts/preview/stacks/ollama/docker-compose.yml`:

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    container_name: preview-ollama
    restart: unless-stopped
    environment:
      OLLAMA_KEEP_ALIVE: "24h"
    volumes:
      - ollama-models:/root/.ollama
    networks:
      - preview-net
    healthcheck:
      test: ["CMD-SHELL", "ollama list >/dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12

volumes:
  ollama-models:

networks:
  preview-net:
    external: true
```

No `ports:` block — Ollama has no authentication and must never be reachable from outside the Docker network.

- [ ] **Step 2: Copy it up and start it**

```bash
scp -i ~/.ssh/id_ed25519 scripts/preview/stacks/ollama/docker-compose.yml \
  root@192.168.178.171:/tmp/ollama-compose.yml
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct push 134 /tmp/ollama-compose.yml /opt/preview/ollama/docker-compose.yml && \
   pct exec 134 -- bash -c 'cd /opt/preview/ollama && docker compose up -d'"
```

- [ ] **Step 3: Pull the model**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- docker exec preview-ollama ollama pull gemma3:4b"
```

Expected: pull progress, ending in `success`. This downloads roughly 3.3 GB and takes several minutes.

- [ ] **Step 4: Verify the model answers**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- docker exec preview-ollama \
     ollama run gemma3:4b 'Reply with exactly the word: ready' --verbose 2>/dev/null | head -1"
```

Expected: output containing `ready`.

- [ ] **Step 5: Verify Ollama is NOT published to the host**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- bash -c 'curl -s --max-time 3 http://127.0.0.1:11434/ >/dev/null && echo PUBLISHED || echo INTERNAL_ONLY'"
```

Expected: `INTERNAL_ONLY`.

- [ ] **Step 6: Commit**

```bash
git add scripts/preview/stacks/ollama/docker-compose.yml
git commit -m "feat(preview): shared Ollama (gemma3:4b) inside the DMZ"
```

---

### Task 3: The `beta` stack

Uses a tag that already exists on GHCR, so this task needs no image build. Find the newest with `docker buildx imagetools inspect` or read it off CT106's compose (read-only).

**Files:**
- Create: `scripts/preview/stacks/app/docker-compose.yml` (one template, parameterised by `.env`)

**Interfaces:**
- Consumes: `preview-net` (Task 1), `ollama` hostname (Task 2).
- Produces: an app container `preview-<slot>` on host port `${HOST_PORT}`, and a DB container `preview-<slot>-db`.

- [ ] **Step 1: Write the parameterised compose template**

Create `scripts/preview/stacks/app/docker-compose.yml`:

```yaml
services:
  db:
    image: postgis/postgis:15-3.4
    container_name: preview-${SLOT}-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: flights
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: flights
      TZ: UTC
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flights -d flights"]
      interval: 5s
      timeout: 5s
      retries: 10

  app:
    image: ghcr.io/abrechen2/travstats:${IMAGE_TAG}
    container_name: preview-${SLOT}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://flights:${POSTGRES_PASSWORD}@db:5432/flights
      TZ: UTC
      APP_VERSION: ${IMAGE_TAG}
      CREATE_DEMO_USER: "false"
      SEED_AIRPORTS: "false"
      USE_LLM_PARSER: "true"
      OLLAMA_URL: http://ollama:11434
      OLLAMA_MODEL: gemma3:4b
      FRONTEND_URL: https://${PUBLIC_HOST}
      ALLOW_REGISTRATION: "false"
    ports:
      - "${HOST_PORT}:80"
    networks:
      - default
      - preview-net

volumes:
  pgdata:

networks:
  preview-net:
    external: true
```

The DB is on the stack-private `default` network only. The app joins both so it can reach `ollama`. No Postgres port is published.

- [ ] **Step 2: Determine the current beta tag (read-only)**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.180 \
  "pct exec 106 -- grep -m1 'image: ghcr' /opt/travstats-beta/docker-compose.yml"
```

Expected: something like `image: ghcr.io/abrechen2/travstats:2.3.0-beta.11`. Use that tag below.

- [ ] **Step 3: Write the stack's `.env` on CT134 with a generated password**

```bash
TAG="<tag from Step 2>"
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c '
  set -e
  PW=\$(openssl rand -hex 24)
  umask 077
  cat > /opt/preview/beta/.env <<EOF
SLOT=beta
HOST_PORT=3010
PUBLIC_HOST=beta.travstats.de
IMAGE_TAG=${TAG}
POSTGRES_PASSWORD=\$PW
EOF
  chmod 600 /opt/preview/beta/.env
  echo written
'"
```

Expected: `written`. The password is generated on the host and never printed.

- [ ] **Step 4: Deploy the compose file and start the stack**

```bash
scp -i ~/.ssh/id_ed25519 scripts/preview/stacks/app/docker-compose.yml \
  root@192.168.178.171:/tmp/app-compose.yml
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct push 134 /tmp/app-compose.yml /opt/preview/beta/docker-compose.yml && \
   pct exec 134 -- bash -c 'cd /opt/preview/beta && docker compose pull -q && docker compose up -d'"
```

- [ ] **Step 5: Verify health and that the DB port is closed**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c '
  curl -sf --max-time 180 --retry 20 --retry-all-errors --retry-delay 3 http://127.0.0.1:3010/health && echo && \
  (curl -s --max-time 3 http://127.0.0.1:5432 >/dev/null 2>&1 && echo DB_EXPOSED || echo DB_CLOSED)'"
```

Expected: a healthy JSON body, then `DB_CLOSED`.

`curl --max-time` bounds the WHOLE retry sequence, not each attempt. A fresh
database runs Prisma migrations on first boot, so `/health` can take 30-60 s to
answer; a short `--max-time` reports a false failure. `--retry-all-errors` is
required too — without it curl does not retry connection refusals.

- [ ] **Step 6: Commit**

```bash
git add scripts/preview/stacks/app/docker-compose.yml
git commit -m "feat(preview): parameterised app stack template, beta slot live"
```

---

### Task 4: `deploy-preview.sh` with tests

**Files:**
- Create: `scripts/preview/deploy-preview.sh`
- Test: `scripts/preview/deploy-preview.test.sh`

Mirrors the existing shell-test pattern in `scripts/wait-then-nginx.test.sh`.

**Interfaces:**
- Consumes: the `.env` files and compose layout from Task 3.
- Produces: `deploy-preview.sh <slot> <tag>` — rewrites `IMAGE_TAG` in the slot's `.env`, pulls, restarts, health-checks. Exits non-zero on unknown slot or failed health check.

- [ ] **Step 1: Write the failing test**

Create `scripts/preview/deploy-preview.test.sh`:

```bash
#!/usr/bin/env bash
# Unit tests for deploy-preview.sh argument handling and .env rewriting.
# Runs entirely locally: DRY_RUN=1 stubs every remote call.
set -uo pipefail

SCRIPT="$(dirname "$0")/deploy-preview.sh"
pass=0; fail=0
check() { # check <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then echo "  ok   $1"; pass=$((pass+1))
  else echo "  FAIL $1: expected '$2', got '$3'"; fail=$((fail+1)); fi
}

# 1. unknown slot is rejected
out=$(DRY_RUN=1 bash "$SCRIPT" bogus 1.2.3 2>&1; echo "rc=$?")
check "unknown slot rejected" "yes" "$([[ "$out" == *"rc=2"* ]] && echo yes || echo no)"

# 2. missing tag is rejected
out=$(DRY_RUN=1 bash "$SCRIPT" beta 2>&1; echo "rc=$?")
check "missing tag rejected" "yes" "$([[ "$out" == *"rc=2"* ]] && echo yes || echo no)"

# 3. each known slot maps to its hostname
for pair in "beta:beta.travstats.de" "immich:immich-beta.travstats.de" "poi:poi-beta.travstats.de"; do
  slot="${pair%%:*}"; host="${pair##*:}"
  out=$(DRY_RUN=1 bash "$SCRIPT" "$slot" 9.9.9 2>&1)
  check "slot $slot -> $host" "yes" "$([[ "$out" == *"$host"* ]] && echo yes || echo no)"
done

# 4. refuses to target a production CTID
out=$(DRY_RUN=1 CTID=100 bash "$SCRIPT" beta 9.9.9 2>&1; echo "rc=$?")
check "refuses CTID != 134" "yes" "$([[ "$out" == *"rc=1"* ]] && echo yes || echo no)"

echo "passed=$pass failed=$fail"
[[ $fail -eq 0 ]]
```

- [ ] **Step 2: Run it to verify it fails**

```bash
bash scripts/preview/deploy-preview.test.sh
```

Expected: FAIL — `deploy-preview.sh` does not exist yet (`No such file or directory`), non-zero exit.

- [ ] **Step 3: Write the implementation**

Create `scripts/preview/deploy-preview.sh`:

```bash
#!/usr/bin/env bash
# Deploy an ALREADY-BUILT GHCR tag to a preview slot on CT134.
# Never builds. Never targets any CT other than 134.
#
#   bash scripts/preview/deploy-preview.sh beta 2.3.0-beta.11
#   bash scripts/preview/deploy-preview.sh immich preview-immich
set -uo pipefail

NODE1="${NODE1:-192.168.178.171}"
CTID="${CTID:-134}"
DRY_RUN="${DRY_RUN:-0}"

if [[ "$CTID" != "134" ]]; then
  echo "refusing: preview deploys only target CT134 (got $CTID)" >&2
  exit 1
fi

slot="${1:-}"; tag="${2:-}"
case "$slot" in
  beta)   host="beta.travstats.de";        port=3010 ;;
  immich) host="immich-beta.travstats.de"; port=3011 ;;
  poi)    host="poi-beta.travstats.de";    port=3012 ;;
  *) echo "usage: $0 <beta|immich|poi> <ghcr-tag>" >&2; exit 2 ;;
esac
[[ -n "$tag" ]] || { echo "usage: $0 <beta|immich|poi> <ghcr-tag>" >&2; exit 2; }

echo "slot=$slot host=$host port=$port tag=$tag"
[[ "$DRY_RUN" == "1" ]] && { echo "dry run, stopping"; exit 0; }

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec $CTID -- bash -c '
    set -e
    cd /opt/preview/$slot
    sed -i \"s|^IMAGE_TAG=.*|IMAGE_TAG=$tag|\" .env
    docker compose pull -q
    docker compose up -d
  '" || { echo "deploy failed" >&2; exit 3; }

echo -n "health: "
ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec $CTID -- curl -sf --max-time 180 --retry 20 --retry-all-errors --retry-delay 3 http://127.0.0.1:$port/health" \
  || { echo "UNHEALTHY" >&2; exit 4; }
echo

echo -n "public: "
curl -sf -o /dev/null -w "%{http_code}\n" --max-time 15 "https://$host/health" \
  || echo "(tunnel not configured yet — expected before Task 7)"
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
chmod +x scripts/preview/deploy-preview.sh scripts/preview/deploy-preview.test.sh
bash scripts/preview/deploy-preview.test.sh
```

Expected: `passed=6 failed=0`, exit 0.

- [ ] **Step 5: Exercise it for real against the beta slot**

```bash
bash scripts/preview/deploy-preview.sh beta "<the tag from Task 3 Step 2>"
```

Expected: `health:` followed by a healthy JSON body. The `public:` line will report that the tunnel is not configured yet — that is correct at this point.

- [ ] **Step 6: Commit**

```bash
git add scripts/preview/deploy-preview.sh scripts/preview/deploy-preview.test.sh
git commit -m "feat(preview): deploy-preview.sh for pre-built GHCR tags"
```

---

### Task 5: Build and deploy the two worktree slots

The `immich` and `poi` branches cut no `-beta.N` version, so they get mutable tags. Build from the worktree, push, then reuse `deploy-preview.sh`.

**Files:**
- Create: `scripts/preview/build-preview-image.sh`

**Interfaces:**
- Consumes: `deploy-preview.sh` (Task 4), the app stack template (Task 3).
- Produces: GHCR tags `:preview-immich` and `:preview-poi`; running stacks on ports 3011 and 3012.

- [ ] **Step 1: Write the build script**

Create `scripts/preview/build-preview-image.sh`:

```bash
#!/usr/bin/env bash
# Build a mutable :preview-<slot> image from a worktree and push to GHCR.
# The tag means "whatever is on that branch right now" — it is intentionally
# not immutable. Never used for RC or release images.
set -euo pipefail

slot="${1:-}"
case "$slot" in
  immich) wt=".claude/worktrees/immich-albums" ;;
  poi)    wt=".claude/worktrees/hotels" ;;
  *) echo "usage: $0 <immich|poi>" >&2; exit 2 ;;
esac

[[ -d "$wt" ]] || { echo "worktree missing: $wt" >&2; exit 1; }

tag="preview-$slot"
commit=$(git -C "$wt" rev-parse --short HEAD)
echo "building $tag from $wt @ $commit"

docker build --platform linux/amd64 \
  --build-arg "VERSION=${tag}-${commit}" \
  -t "ghcr.io/abrechen2/travstats:${tag}" \
  "$wt"

docker push "ghcr.io/abrechen2/travstats:${tag}"
echo "pushed ghcr.io/abrechen2/travstats:${tag} ($commit)"
```

- [ ] **Step 2: Create the two `.env` files on CT134**

```bash
for spec in "immich:3011:immich-beta.travstats.de" "poi:3012:poi-beta.travstats.de"; do
  slot="${spec%%:*}"; rest="${spec#*:}"; port="${rest%%:*}"; host="${rest##*:}"
  ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c '
    set -e
    PW=\$(openssl rand -hex 24)
    umask 077
    cat > /opt/preview/${slot}/.env <<EOF
SLOT=${slot}
HOST_PORT=${port}
PUBLIC_HOST=${host}
IMAGE_TAG=preview-${slot}
POSTGRES_PASSWORD=\$PW
EOF
    chmod 600 /opt/preview/${slot}/.env
    echo ${slot} written
  '"
done
```

Expected: `immich written`, `poi written`.

- [ ] **Step 3: Copy the compose template into both slots**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- bash -c 'cp /opt/preview/beta/docker-compose.yml /opt/preview/immich/ && \
                            cp /opt/preview/beta/docker-compose.yml /opt/preview/poi/ && ls /opt/preview/*/docker-compose.yml'"
```

Expected: three paths listed.

- [ ] **Step 4: Build and push both images**

```bash
chmod +x scripts/preview/build-preview-image.sh
bash scripts/preview/build-preview-image.sh immich
bash scripts/preview/build-preview-image.sh poi
```

Expected: each ends with `pushed ghcr.io/abrechen2/travstats:preview-<slot> (<sha>)`.

The Dockerfile runs `npm ci` in its own build stages, so the worktree needs no local `node_modules` — do not run `install:all` first. There is no `.dockerignore` in this repo; the build context is the whole worktree, which is small only because those worktrees were never `npm install`ed. If one of them has a `node_modules/`, expect a slow context upload.

- [ ] **Step 5: Deploy both slots**

```bash
bash scripts/preview/deploy-preview.sh immich preview-immich
bash scripts/preview/deploy-preview.sh poi preview-poi
```

Expected: a healthy body for each. The `public:` line still reports the tunnel is missing.

- [ ] **Step 6: Commit**

```bash
git add scripts/preview/build-preview-image.sh
git commit -m "feat(preview): build mutable :preview-<slot> images from worktrees"
```

---

### Task 6: Seed accounts and close registration

> **Ordering is load-bearing: this task MUST complete before Task 7 opens the tunnel.**
> `routes/auth.ts:66-78` allows registration unconditionally when the user table
> is empty (`isFirstUser`), regardless of `allowRegistration`. That is correct
> behaviour for a fresh self-hosted install, but it means an empty preview DB
> behind a public URL lets the first stranger to find it register — and
> `init.ts` grants the first user admin. Seed first, expose second.

**Files:**
- Create: `scripts/preview/seed-preview-users.sh`

**Interfaces:**
- Consumes: running stacks from Tasks 3 and 5.
- Produces: users `demo`, `alex`, `claude` on each slot; `allowRegistration=false` persisted in each DB.

- [ ] **Step 1: Write the seed script**

Create `scripts/preview/seed-preview-users.sh`:

```bash
#!/usr/bin/env bash
# Seed demo/alex/claude on a preview slot and close registration.
# Passwords are generated, written to /opt/preview/<slot>/USERS.txt (0600),
# and printed ONCE so they can be moved into a password manager.
set -euo pipefail

NODE1="${NODE1:-192.168.178.171}"
slot="${1:-}"
case "$slot" in beta|immich|poi) ;; *) echo "usage: $0 <beta|immich|poi>" >&2; exit 2 ;; esac

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec 134 -- bash -c '
    set -e
    umask 077
    : > /opt/preview/${slot}/USERS.txt
    for u in demo alex claude; do
      PW=\$(openssl rand -base64 12 | tr -d /=+ | cut -c1-14)
      docker exec preview-${slot} node -e \"
        const { seedDemoUser } = require(\\\"/app/backend/dist/seedDemoUser.js\\\");
        seedDemoUser({ username: process.argv[1], password: process.argv[2],
                       isAdmin: false, resetCredentials: true })
          .then(() => process.exit(0))
          .catch(e => { console.error(e); process.exit(1); });
      \" \"\$u\" \"\$PW\"
      echo \"\$u \$PW\" >> /opt/preview/${slot}/USERS.txt
    done
    chmod 600 /opt/preview/${slot}/USERS.txt
    docker exec preview-${slot}-db psql -U flights -d flights -c \
      \"UPDATE admin_settings SET allow_registration = false;\" >/dev/null
    cat /opt/preview/${slot}/USERS.txt
  '"
```

Verified against the live schema: the table is `admin_settings`, the column is
`allow_registration`, and its Prisma default is already `false`. The `UPDATE`
is belt-and-braces — it affects zero rows until the app has lazily created the
singleton row (`ensureAdminSettings()`), which it does on the first settings
read. Step 3's `register=403` probe is the check that actually matters.

- [ ] **Step 2: Seed the beta slot**

```bash
chmod +x scripts/preview/seed-preview-users.sh
bash scripts/preview/seed-preview-users.sh beta
```

Expected: three `username password` lines. Copy them into the password manager now — they are not printed again.

- [ ] **Step 3: Verify login works and registration is closed**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c '
  curl -s -o /dev/null -w \"login=%{http_code}\n\" -X POST http://127.0.0.1:3010/api/v1/auth/login \
    -H \"Content-Type: application/json\" \
    --data \"{\\\"username\\\":\\\"demo\\\",\\\"password\\\":\\\"\$(cut -d\\\" \\\" -f2 < <(grep ^demo /opt/preview/beta/USERS.txt))\\\"}\"
  curl -s -o /dev/null -w \"register=%{http_code}\n\" -X POST http://127.0.0.1:3010/api/v1/auth/register \
    -H \"Content-Type: application/json\" --data \"{\\\"username\\\":\\\"probe\\\",\\\"password\\\":\\\"Probe12345!\\\"}\"
'"
```

Expected: `login=200` and `register=403` (registration refused).

- [ ] **Step 4: Seed the other two slots**

```bash
bash scripts/preview/seed-preview-users.sh immich
bash scripts/preview/seed-preview-users.sh poi
```

Expected: three credential lines each.

- [ ] **Step 5: Commit**

```bash
git add scripts/preview/seed-preview-users.sh
git commit -m "feat(preview): seed demo/alex/claude and close registration"
```

---

### Task 7: Cloudflare tunnel, ingress and DNS

**Files:**
- Create: `scripts/preview/setup-tunnel.sh`

**Interfaces:**
- Consumes: running stacks on ports 3010/3011/3012.
- Produces: a tunnel `travstats-preview`, three ingress rules, three proxied CNAMEs, and `cloudflared` running as a systemd service on CT134.

- [ ] **Step 1: Write the tunnel setup script**

Create `scripts/preview/setup-tunnel.sh`:

```bash
#!/usr/bin/env bash
# Create the travstats-preview tunnel, configure ingress, point DNS at it,
# and install cloudflared on CT134. Idempotent.
set -euo pipefail

TOKEN_FILE="${TOKEN_FILE:-$HOME/.cloudflare-travstats-token}"
[[ -f "$TOKEN_FILE" ]] || { echo "missing $TOKEN_FILE" >&2; exit 1; }
TOK=$(cat "$TOKEN_FILE")
ZONE=8e34d30898073f3ee7e95bc0bdcb4022
ACCT=9a4d9c86ff53f151156fc1361af434cf
NODE1="${NODE1:-192.168.178.171}"
API=https://api.cloudflare.com/client/v4
NAME=travstats-preview

cf() { curl -s -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" "$@"; }

# Never trust an empty tunnel list — verify the token can see tunnels at all.
probe=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOK" \
  "$API/accounts/$ACCT/cfd_tunnel")
[[ "$probe" == "200" ]] || { echo "token cannot read tunnels (HTTP $probe)" >&2; exit 1; }

id=$(cf "$API/accounts/$ACCT/cfd_tunnel?name=$NAME&is_deleted=false" \
  | python -c "import sys,json;r=json.load(sys.stdin)['result'];print(r[0]['id'] if r else '')")

if [[ -z "$id" ]]; then
  secret=$(openssl rand -base64 32)
  resp=$(cf -X POST "$API/accounts/$ACCT/cfd_tunnel" \
    --data "$(python -c "import json,sys;print(json.dumps({'name':'$NAME','tunnel_secret':'$secret','config_src':'cloudflare'}))")")
  id=$(echo "$resp" | python -c "import sys,json;d=json.load(sys.stdin);
print(d['result']['id']) if d['success'] else sys.exit('create failed: '+json.dumps(d['errors']))")
  echo "created tunnel $NAME ($id)"
else
  echo "tunnel $NAME already exists ($id)"
fi

# Ingress: three hostnames -> localhost ports, plus the mandatory catch-all.
cf -X PUT "$API/accounts/$ACCT/cfd_tunnel/$id/configurations" --data '{
  "config": {
    "ingress": [
      {"hostname": "beta.travstats.de",        "service": "http://localhost:3010"},
      {"hostname": "immich-beta.travstats.de", "service": "http://localhost:3011"},
      {"hostname": "poi-beta.travstats.de",    "service": "http://localhost:3012"},
      {"service": "http_status:404"}
    ]
  }
}' | python -c "import sys,json;d=json.load(sys.stdin);print('ingress ok' if d['success'] else sys.exit('ingress failed: '+json.dumps(d['errors'])))"

# DNS: proxied CNAMEs at <name>.travstats.de -> <id>.cfargotunnel.com
for h in beta immich-beta poi-beta; do
  target="$id.cfargotunnel.com"
  rid=$(cf "$API/zones/$ZONE/dns_records?type=CNAME&name=$h.travstats.de" \
    | python -c "import sys,json;r=json.load(sys.stdin)['result'];print(r[0]['id'] if r else '')")
  body=$(python -c "import json;print(json.dumps({'type':'CNAME','name':'$h','content':'$target','proxied':True,'ttl':1}))")
  if [[ -n "$rid" ]]; then
    cf -X PUT "$API/zones/$ZONE/dns_records/$rid" --data "$body" >/dev/null
    echo "updated $h.travstats.de"
  else
    cf -X POST "$API/zones/$ZONE/dns_records" --data "$body" >/dev/null
    echo "created $h.travstats.de"
  fi
done

# Install cloudflared on CT134 using the tunnel's connector token.
ttok=$(cf "$API/accounts/$ACCT/cfd_tunnel/$id/token" \
  | python -c "import sys,json;print(json.load(sys.stdin)['result'])")

ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no "root@${NODE1}" \
  "pct exec 134 -- bash -c '
    set -e
    if ! command -v cloudflared >/dev/null 2>&1; then
      curl -fsSL -o /tmp/cf.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
      dpkg -i /tmp/cf.deb && rm -f /tmp/cf.deb
    fi
    systemctl is-active --quiet cloudflared || cloudflared service install $ttok
    systemctl enable --now cloudflared
    systemctl is-active cloudflared
  '"

echo "tunnel ready: $id"
```

- [ ] **Step 2: Run it**

```bash
chmod +x scripts/preview/setup-tunnel.sh
bash scripts/preview/setup-tunnel.sh
```

Expected: `created tunnel travstats-preview (<uuid>)`, `ingress ok`, three `created <host>` lines, `active`, `tunnel ready: <uuid>`.

- [ ] **Step 3: Verify the tunnel reports healthy**

```bash
TOK=$(cat ~/.cloudflare-travstats-token)
curl -s -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/accounts/9a4d9c86ff53f151156fc1361af434cf/cfd_tunnel?name=travstats-preview" \
  | python -c "import sys,json;t=json.load(sys.stdin)['result'][0];print(t['name'], t['status'])"
```

Expected: `travstats-preview healthy`.

- [ ] **Step 4: Verify all three hostnames serve over HTTPS**

```bash
for h in beta immich-beta poi-beta; do
  echo -n "$h.travstats.de -> "
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 "https://$h.travstats.de/health"
done
```

Expected: `200` three times. DNS propagation through Cloudflare is near-instant; if a name returns 000, wait 30 seconds and retry once.

A TLS error here means a hostname slipped back to a two-level form (`immich.beta.travstats.de`). Universal SSL does not cover it. Fix the name, do not buy a certificate.

- [ ] **Step 5: Commit**

```bash
git add scripts/preview/setup-tunnel.sh
git commit -m "feat(preview): cloudflared tunnel, ingress and DNS for three hostnames"
```

---

### Task 8: End-to-end verification

No new files. This is the gate before anyone is invited.

- [ ] **Step 1: Re-run the isolation negative test**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- bash -c 'curl -s --max-time 5 http://192.168.178.155:11434/ >/dev/null && echo REACHABLE || echo BLOCKED'"
```

Expected: `BLOCKED`. Docker installs iptables rules; this confirms none of them opened a path to the LAN.

- [ ] **Step 2: Confirm the untouched hosts are untouched**

```bash
for ct in 100 106 107; do
  echo -n "CT$ct image: "
  ssh -i ~/.ssh/id_ed25519 root@192.168.178.180 \
    "pct exec $ct -- bash -c 'grep -m1 \"image: ghcr\" /opt/travstats*/docker-compose.yml'" 2>/dev/null || echo "?"
done
```

Expected: the same tags they ran before this work started. If any changed, something in this plan targeted the wrong CT — stop and report.

- [ ] **Step 3: Log in through the public URL and render the map**

For each of `beta.travstats.de`, `immich-beta.travstats.de`, `poi-beta.travstats.de`, open the site in a browser (or drive it with the Playwright MCP), log in as `demo`, and confirm the dashboard map renders.

`/health` passes even when the frontend bundle is broken. The map is the check that catches a bad deploy — see `feedback_dashboard_geo_pagination` for the class of bug that only shows on screen.

- [ ] **Step 4: Confirm registration is refused from the public side**

```bash
for h in beta immich-beta poi-beta; do
  echo -n "$h register -> "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://$h.travstats.de/api/v1/auth/register" \
    -H "Content-Type: application/json" --data '{"username":"probe","password":"Probe12345!"}'
done
```

Expected: `403` three times.

- [ ] **Step 5: Confirm the parser reaches the DMZ Ollama**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- docker exec preview-beta sh -c 'curl -sf --max-time 10 http://ollama:11434/api/tags | head -c 120'"
```

Expected: a JSON body listing `gemma3:4b`.

---

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.local.md` (add CT134 to the topology table)
- Modify: `docs/RELEASE_WORKFLOW.md:26` (environments table — add a Preview row)
- Modify: `.claude/skills/travstats-deploy/SKILL.md:144` (beta deploy step 4 — mention the optional preview target)

- [ ] **Step 1: Add CT134 to `CLAUDE.local.md`**

Insert a row into the 3-tier topology table, and a short section below it:

```markdown
| **Preview** | 134 | `192.168.20.134:3010-3012` (DMZ) | `preview-beta` / `-immich` / `-poi` | je eigene | `/opt/preview/<slot>` | **öffentlich**, Demo-Daten, externe Tester |

## Public Preview (CT134, DMZ — seit 2026-07-09)

Drei öffentliche Demo-Instanzen, `beta.travstats.de`,
`immich-beta.travstats.de`, `poi-beta.travstats.de`. Nur Demo-Daten,
Registrierung zu, eigene Ollama (`gemma3:4b`) in der DMZ — **kein
LAN-Zugriff**, deshalb ist Parse-Qualität dort nicht prod-repräsentativ.

`scripts/stage-rc-from-prod.sh` NIEMALS gegen CT134 laufen lassen.

    bash scripts/preview/deploy-preview.sh beta 2.3.0-beta.11
    bash scripts/preview/build-preview-image.sh immich && \
      bash scripts/preview/deploy-preview.sh immich preview-immich
```

- [ ] **Step 2: Add the Preview row to `docs/RELEASE_WORKFLOW.md`**

In the §1 Environments table, after the Beta row:

```markdown
| **Preview** | CT134 (pve-node1, DMZ) | `beta.travstats.de`, `immich-beta.…`, `poi-beta.…` | own, per slot | Public demo instances for external testers; demo data only, never a prod dump |
```

- [ ] **Step 3: Extend the beta-deploy step in the deploy skill**

In `.claude/skills/travstats-deploy/SKILL.md`, after step 4 of "Beta deploy", add:

```markdown
4b. **Optionally** mirror the same `:X.Y.Z-beta.N` tag to the public preview,
    when the user asks for it:
    `bash scripts/preview/deploy-preview.sh beta X.Y.Z-beta.N`
    No rebuild — the image already exists on GHCR. The `announce beta` embed
    in step 7 then links `https://beta.travstats.de`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.local.md docs/RELEASE_WORKFLOW.md .claude/skills/travstats-deploy/SKILL.md
git commit -m "docs: record CT134 public preview tier"
```

Note: `CLAUDE.local.md` is gitignored. Verify with `git check-ignore -v CLAUDE.local.md`; if it is ignored, edit it but drop it from the `git add` line.

---

### Task 10: Credential rotation — mandatory, do not skip

Spec §13. Three Cloudflare tokens and one DDNS key passed through the chat transcript. Two of the tokens are already superseded and grant real access right now.

- [ ] **Step 1: Revoke the two superseded tokens**

In the Cloudflare dashboard → *My Profile* → *API Tokens*, delete:
- the DNS-only token (`cfat_Syo…`)
- the tunnel-only token (`cfat_oiZ3…`)

Nothing depends on either. Verify by confirming they no longer appear in the token list.

- [ ] **Step 2: Rotate the active token**

Create a replacement with the same permissions (`Zone → DNS → Edit` on `travstats.de`, `Account → Cloudflare Tunnel → Edit`), write it to `~/.cloudflare-travstats-token` (`chmod 600`), then delete the old one (`cfat_igBB…`).

Consider widening or removing the IP allowlist — it is currently pinned to `87.138.182.241`, a dynamic WAN address. When it changes, the token fails in a way that looks like a permissions error.

- [ ] **Step 3: Verify the new token still works**

```bash
TOK=$(cat ~/.cloudflare-travstats-token)
curl -s -o /dev/null -w "dns=%{http_code}\n" -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/zones/8e34d30898073f3ee7e95bc0bdcb4022/dns_records?per_page=1"
curl -s -o /dev/null -w "tunnel=%{http_code}\n" -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/accounts/9a4d9c86ff53f151156fc1361af434cf/cfd_tunnel"
```

Expected: `dns=200` and `tunnel=200`. Do not use `/user/tokens/verify` — it returns 401 for account-scoped tokens regardless.

- [ ] **Step 4: Rotate the CT121 DDNS key (owner decision required)**

This key predates this work but was exposed during it. It sits in plaintext in `/opt/cloudflare-ddns/docker-compose.yml` on CT121 and covers the `abrechen2.de` zone.

Ask the owner before touching CT121. If approved: issue a scoped token (`Zone → DNS → Edit` on `abrechen2.de`), move it out of the compose file into `/opt/cloudflare-ddns/.env` (`chmod 600`), reference it via `env_file:`, `docker compose up -d`, confirm the DDNS container logs a successful update, then revoke the old key.

- [ ] **Step 5: Delete the dead `sublarr-wiki` tunnel (optional cleanup)**

Tunnel `38121002-2c8c-4f81-af5d-3a3d90565dc9` is `down` and points at CT131, which no longer exists. Removing it and correcting `CCProxmox/CLAUDE.md` (which still lists CT101 and CT131) is out of scope here but noted in spec §14.

---

### Task 11: Demo Immich in the DMZ (scope added 2026-07-09)

The `immich` slot runs the Immich-album integration, but the DMZ cannot reach any Immich server: the owner's lives on the LAN, and asking testers to paste a real Immich API key into a public pre-release instance is not acceptable. So the preview gets its own throwaway Immich with sample photos.

Incidental benefit: `immichResolver.ts` fetches a user-supplied URL server-side — a classic SSRF vector. From the DMZ it reaches nothing internal.

**Files:**
- Create: `scripts/preview/stacks/immich-demo/docker-compose.yml`
- Create: `scripts/preview/seed-immich-demo.sh`

**Interfaces:**
- Consumes: `preview-net` (Task 1), the `immich` app stack (Task 5).
- Produces: `immich-demo-server` reachable at `http://immich-demo-server:2283` on `preview-net`; an API key stored as the `immich` slot's admin-global config.

- [ ] **Step 1: Rebuild the `immich` slot at the branch tip**

The deployed image is `preview-immich-9fc71971`; the branch is at `070471a4`, which is where the import pipeline landed. Without it there is nothing to demo.

```bash
bash scripts/preview/build-preview-image.sh immich
bash scripts/preview/deploy-preview.sh immich preview-immich
```

Verify the version moved (note: this workstation's AdGuard DNS may still cache NXDOMAIN for the new hostnames; resolve via 1.1.1.1 and `curl --resolve` if so):

```bash
curl -s https://immich-beta.travstats.de/health
```

Expected: `"version":"preview-immich-070471a4"`, or newer if the branch advanced again — record whatever you actually built.

- [ ] **Step 2: Write the Immich compose file**

Create `scripts/preview/stacks/immich-demo/docker-compose.yml`. Images are taken from Immich's official `docker/docker-compose.yml` as of 2026-07-09. `immich-machine-learning` is deliberately omitted — it costs roughly 1.5 GB of RAM and only powers smart search, which this demo does not exercise.

```yaml
services:
  immich-demo-server:
    image: ghcr.io/immich-app/immich-server:release
    container_name: immich-demo-server
    restart: unless-stopped
    environment:
      DB_HOSTNAME: immich-demo-db
      DB_USERNAME: postgres
      DB_PASSWORD: ${DB_PASSWORD}
      DB_DATABASE_NAME: immich
      REDIS_HOSTNAME: immich-demo-redis
      IMMICH_MACHINE_LEARNING_ENABLED: "false"
      TZ: UTC
    volumes:
      - immich-upload:/data
    depends_on:
      - immich-demo-redis
      - immich-demo-db
    networks:
      - default
      - preview-net

  immich-demo-redis:
    image: docker.io/valkey/valkey:9
    container_name: immich-demo-redis
    restart: unless-stopped

  immich-demo-db:
    image: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0
    container_name: immich-demo-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: immich
    volumes:
      - immich-pgdata:/var/lib/postgresql/data

volumes:
  immich-upload:
  immich-pgdata:

networks:
  preview-net:
    external: true
```

No `ports:` block anywhere. Immich must be reachable only from `preview-net` — never from the container host, never from the internet.

- [ ] **Step 3: Deploy it**

Generate the DB password on the container; never print it.

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -s" <<'SH'
set -e
mkdir -p /opt/preview/immich-demo
umask 077
printf 'DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > /opt/preview/immich-demo/.env
chmod 600 /opt/preview/immich-demo/.env
echo "env written"
SH

scp -i ~/.ssh/id_ed25519 scripts/preview/stacks/immich-demo/docker-compose.yml \
  root@192.168.178.171:/tmp/immich-demo.yml
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct push 134 /tmp/immich-demo.yml /opt/preview/immich-demo/docker-compose.yml && \
   pct exec 134 -- bash -c 'cd /opt/preview/immich-demo && docker compose pull -q && docker compose up -d'"
```

Then wait for it to answer — first boot runs migrations and takes a minute or two:

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- docker exec preview-immich sh -c 'wget -qO- --timeout=10 http://immich-demo-server:2283/api/server/ping'"
```

Expected: `{"res":"pong"}`. The TravStats app image has **no curl** — use `wget -qO-` inside it.

- [ ] **Step 4: Write the seed script**

Create `scripts/preview/seed-immich-demo.sh`: it creates the admin account, mints an API key, and stores both in `/opt/preview/immich-demo/CREDENTIALS.txt` (mode 0600) on CT134.

Immich's API changes between releases. **Before relying on any endpoint below, check it against the running instance's live spec** at `http://immich-demo-server:2283/api/spec-json` (reachable from inside `preview-immich`). If an endpoint or field name differs, follow the spec, not this brief, and say so in your report.

The endpoints this task assumes:
- `POST /api/auth/admin-sign-up` — body `{email, password, name}`; succeeds only on a virgin instance
- `POST /api/auth/login` — body `{email, password}`; returns `accessToken`
- `POST /api/api-keys` — body `{name, permissions}`; returns `secret`

Use `bash -s` with a heredoc for the remote side. Nested `ssh "pct exec … bash -c '…'"` mangles quoting — this has already cost two false negatives in this plan.

- [ ] **Step 5: Upload sample photos and create albums**

Fetch two or three freely usable images (`https://picsum.photos/1200/800` serves them), upload via `POST /api/assets` with the `x-api-key` header, create two albums via `POST /api/albums`, and add the assets to them.

Confirm:

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 \
  "pct exec 134 -- docker exec preview-immich sh -c \
    'wget -qO- --header=\"x-api-key: <KEY>\" http://immich-demo-server:2283/api/albums'"
```

Expected: a JSON array with two albums, each reporting a non-zero `assetCount`.

- [ ] **Step 6: Point the TravStats `immich` slot at it**

Read `backend/src/routes/admin/immich.ts` and `backend/src/services/immich/immichResolver.ts` in the `dev/immich-albums` worktree (`D:/TravStats_Projekt/TravStats/.claude/worktrees/immich-albums`) to learn the admin-global config endpoint and its payload shape.

Configure the running `preview-immich` instance to use `http://immich-demo-server:2283` and the API key from Step 4 at the **admin-global** tier — not per-user — so every tester inherits a working connection without supplying a key.

Verify through the app's own connection tester (the branch adds `immichTester.ts`), not by curling Immich directly. The claim under test is "TravStats can reach Immich", not "you can reach Immich".

- [ ] **Step 7: Confirm Immich stayed private**

```bash
ssh -i ~/.ssh/id_ed25519 root@192.168.178.171 "pct exec 134 -- bash -c '
  (curl -s --max-time 3 http://127.0.0.1:2283/ >/dev/null 2>&1 && echo HOST_EXPOSED || echo INTERNAL_ONLY)
  docker inspect immich-demo-server --format "{{json .HostConfig.PortBindings}}"
'"
```

Expected: `INTERNAL_ONLY` and `{}`.

If either check fails, stop and report BLOCKED. An Immich instance exposed beside a public pre-release app is a data-handling defect, not a rough edge.

- [ ] **Step 8: Commit**

```bash
git add scripts/preview/stacks/immich-demo/docker-compose.yml scripts/preview/seed-immich-demo.sh
git commit -m "feat(preview): demo Immich stack so the immich slot is testable"
```
