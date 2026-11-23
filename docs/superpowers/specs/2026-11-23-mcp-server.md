# MCP server for TravStats — plan

Status: plan only, nothing built. Asked for by the owner on 2026-11-23.
Branch: `docs/mcp-plan`.

## 1. Goal and non-goals

**Goal:** an AI assistant (Claude Desktop/Code, any MCP client) can read a user's
TravStats data and, with the user's consent per call, add or confirm entries — through
the same REST API, scopes and checks the web and the Companion use.

**Non-goal:** no second API, no admin surface, no new business logic in the MCP layer —
every rule (counting, abstention, provenance, sharing propagation) stays in the server.

## 2. Architecture

### What exists

- A personal access token (`ts_pat_…`, `utils/apiTokens.ts`) with scope `read`, `write`
  or `admin`, checked in `middleware/auth.ts`. `admin` needs the user's admin flag on top;
  a `write` token never inherits admin. Each token has `lastUsedAt`, `lastUsedIp`,
  `expiresAt`, `revokedAt`.
- `GET /api/v1/openapi.json`, generated from code; it covers every user route.
  `openapi.coverage.test.ts` fails on an undocumented route; admin routes and the
  server-to-server mounts are excluded (`services/openapi/coverage.ts`
  `UNDOCUMENTED_MOUNTS`).
- `GET /api/v1/version` names the server version.

### Options

| | (a) `travstats-mcp` stdio package | (b) remote endpoint `/api/v1/mcp` |
|---|---|---|
| Runs | on the user's machine, started by the MCP client | inside the TravStats server (streamable HTTP) |
| Auth | server URL + PAT from env/config | PAT as bearer now, OAuth 2.1 (MCP auth spec) later |
| Server change | none; a plain API client | new mount, session handling, OAuth server |
| Reach | desktop clients only | also claude.ai / mobile connectors — but only if the instance is reachable from the provider's cloud |
| Attack surface | none added to the server | a new public, long-lived streaming endpoint |
| Release coupling | own version, can lag the server | ships with every server release |

And orthogonal to (a)/(b):

| | (c1) tools generated from `openapi.json` | (c2) curated tool set |
|---|---|---|
| Size | ~400 operations → hundreds of tools; models choose badly beyond ~30 | ≤ 15 tools with task-shaped names |
| Safety | every write route is exposed, incl. deletes | write tools chosen and guarded one by one |
| Drift | none by construction | needs a contract test (below) |
| Output | raw API payloads (big, id-heavy) | trimmed, names instead of ids, provenance kept |

### Recommendation

**(a) + (c2): a local stdio package `travstats-mcp` with a curated tool set, held to the
REST contract by tests against `openapi.json`. (b) only as M3, behind a beta gate and an
admin switch, once (a) has shown which tools people use.**

Why:

- **Security.** (a) adds no server surface: it speaks the existing, tested REST API with a
  PAT the user created and can revoke. Scope stays the server's job — a `read` token makes
  every write tool fail with 403 on the server, not just hidden in the client. The package
  refuses an `admin` token at start-up (needs `GET /auth/me` to report the token's
  scope, which it does not today — the one server change in M1), so "no admin by default" is a hard rule, not a setting.
- **Privacy, plainly.** Whatever a tool returns goes to the AI provider the user's client
  talks to (Anthropic, OpenAI, …) and is stored under that provider's terms. TravStats
  cannot take that back. The token-creation dialog and the README say so in one sentence
  each (DE/EN), and the tools return the minimum: summaries, not raw rows; no document
  bytes, no photo bytes, no passport/loyalty numbers, no co-traveller contact data.
  Abstention travels through: a value the server returns as `null` stays `null` with its
  reason, never `0`; an `onlyRecorded` view says it is one.
- **Rate limits.** The API's existing limiters apply per user/IP; the package adds no
  bypass. It adds a client-side budget (default 60 calls/min, 1 job start/min) so a
  looping agent stops before the server's limiter trips, and surfaces a 429 as itself.
- **Egress catalogue.** (a) is not an outbound call of the server, so
  `externalServices/catalogue.ts` is untouched. Server-side work a tool triggers (the LLM
  parser for "add a flight from text", the routing engine for "reroute") already goes
  through the catalogue and its switches; a disabled service comes back as its reason.
  (b) would also stay out of the catalogue (inbound), but its OAuth discovery must not add
  any outbound fetch.
- **The Companion** is unaffected: same API, no new contract. The server stays the record
  — the MCP layer holds no data and caches nothing beyond one call.
- **Versioning.** The package states a minimum server version and reads
  `GET /api/v1/version` at start; below it, it starts with only the tools whose routes
  exist and says which are missing. Its own semver is independent of `backend/VERSION`.
- **Public repo.** The package lives in this repo (`packages/travstats-mcp`, AGPL-3.0 like
  the backend) so the contract test can read the generated spec in CI. Nothing private
  in it: no hosts, no sample data from real accounts. Docs go to TravStatsWeb.

## 3. Curated first tool set (15 tools)

Common rules: inputs are Zod-validated in the package before any call; outputs are
trimmed JSON plus a one-line text summary; every output carries `instance` (base URL)
and, where the server provides it, `provenance` and `link` (the web URL of the editable
record, per the "provenance visible" rule). Ids are returned so a follow-up call can use
them, but names lead.

### Read (scope `read`)

| # | Tool | Wraps | Input | Output |
|---|---|---|---|---|
| R1 | `search_entries` | `GET /search` | `q`, `domains?[]`, `limit? ≤ 25` | hits `{domain, id, title, date, place, link}` |
| R2 | `list_trips` | `GET /trips` | `from?`, `to?`, `limit? ≤ 50` | `{id, name, start, end, countries[], entryCount}` |
| R3 | `get_trip_summary` | `GET /trips/:id`, `GET /trips/:id/routes` | `tripId` | trip with legs per domain, stays, places, totals (distance, nights) with `null`+reason where underivable |
| R4 | `get_stats` | `GET /stats/summary`, `/stats/countries`, `/stats/timeseries`, `GET /purpose/visibility` | `view: summary\|countries\|timeseries`, `year?`, `onlyRecorded?: boolean`, `purpose?: private\|business\|all` | the server's figures verbatim; `onlyRecorded` echoed; hidden-purpose entries stay hidden exactly as the purpose-visibility setting says |
| R5 | `get_upcoming` | `GET /upcoming` | `days? ≤ 90` | next entries across domains |
| R6 | `get_travtrack_day` | `GET /travtrack/day` | `date` (local, `YYYY-MM-DD`) | stays, moves, places of that day — **no raw point list** (Q4) |
| R7 | `list_inbox` | `GET /trip-suggestions`, `/location-suggestions`, `/data-quality-flags`, `/pending-updates`, `/provenance/notices` | `kinds?[]`, `limit? ≤ 25` per kind | `{kind, id, title, why, createdAt}`; a failing source is reported as that source's error, never dropped |
| R8 | `get_readiness` | `GET /readiness` | — | items that need attention `{id, title, action, link}` |
| R9 | `get_routing_run` | `GET /routing-runs/:id` | `runId` | `{status, done, total, failures[]}` — the follow-up W6 hands out |

### Write (scope `write`; each needs `confirm: true`, see §5)

| # | Tool | Wraps | Input | Output |
|---|---|---|---|---|
| W1 | `parse_flight_text` | `POST /parse-email` | `text` (≤ 20 kB) | a **draft** `{flights[], warnings[]}` — saves nothing; no confirm needed (it writes nothing, but needs `write` because the route does) |
| W2 | `parse_boarding_pass` | `POST /parse-boardingpass` (`imageBase64`) | `fileName` inside the configured `TRAVSTATS_MCP_FILES_DIR` only (realpath must stay inside it, no symlink out, JPEG/PNG/PDF magic bytes, size cap); without that setting the tool is not offered | draft as W1 |
| W3 | `add_flight` | `POST /flights` | a draft from W1/W2 or explicit fields (Zod mirror of the server schema), `confirm` | created flight `{id, link}` plus any inbox checks queued |
| W4 | `add_place_visit` | `POST /places` (when new) + `POST /places/:id/visits` | `placeId?` or `{name, lat, lon}`, `date`, `note?`, `confirm` | `{placeId, visitId, link}`; if the visit fails after the place was created, it returns `partial` with the new `placeId` so a retry reuses it instead of creating a duplicate |
| W5 | `resolve_inbox_item` | `POST /trip-suggestions/:id/accept\|dismiss`, `/location-suggestions/:id/accept\|reject`, `/data-quality-flags/:id/resolve\|dismiss`, `/pending-updates/:id/apply` / `POST /pending-updates/reject`, `/provenance/notices/:id/dismiss` | `kind`, `id`, `action` from that kind's own vocabulary (`accept\|dismiss`, `accept\|reject`, `resolve\|dismiss`, `apply\|reject`, `dismiss`) — a discriminated union, so the model sees what each action does — and `confirm` | the server's result, incl. undo hint where one exists (`/data-quality-flags/:id/undo`) |
| W6 | `reroute_trip_legs` | `POST /tours/:routeId/reroute-all`, then `GET /routing-runs/:id` | `routeId`, `confirm` | a job `{runId, status}`; the tool polls up to 30 s (respecting the client's cancellation), then returns the run id for R9 instead of pretending it finished |

Every list tool pages (`cursor`) and caps output at ~20 kB with an explicit `truncated: true`; dates are the entry's local date with its zone, as the server returns them.

Not in the first set, on purpose: any delete, trip merge/dissolve, sharing, imports of
archives, photo/document upload, settings, tokens, admin. An assistant that wants them
links the user to the web page.

## 4. Resources and prompts

- **Resources** (read scope, `travstats://` URIs): `travstats://trip/{id}` (same body as
  R3, so a client can attach a trip as context), `travstats://year/{yyyy}` (R4 summary
  for one year). No resource listing of all trips (that is R2, paged) — a client that
  lists resources eagerly would otherwise pull the whole account.
- **Prompts:** `trip_report` ("write a short report of trip X from its summary") and
  `add_from_confirmation` ("parse this text, show me the draft, add it after I say yes").
  Both only orchestrate existing tools.

## 5. Security rules

1. **The token never appears in tool output, logs or errors.** The package reads it from
   `TRAVSTATS_TOKEN` (or a file path), redacts `ts_pat_[0-9a-f]+` from every string it
   returns or logs, and a test feeds a server error that echoes the header.
2. **`admin` tokens are refused** at start; there is no flag to allow them in M1–M2.
3. **Every write tool has a required `confirm: true` field** and the tool description
   says to ask the user first. Without it the tool returns the payload it *would* send
   (a dry run). MCP clients also show tool calls for approval; `confirm` is the
   server-independent second gate, and the description marks write tools with
   `destructiveHint`/`readOnlyHint` annotations. `confirm` is set by the model, so it is
   not proof of consent: the README tells users to keep the client's per-call approval on
   for write tools, and text the tools return (emails, notes) is treated as untrusted.
   Writes send the existing `If-Match`/`baseVersion` precondition where the route takes
   one, so an edit on stale data fails instead of overwriting.
4. **Audit.** M1/M2: a local JSONL log per call (`tool, args minus free text, status,
   duration`), off by default, path in the README. Server side (M2): the token's
   `lastUsedAt` already exists; add `X-TravStats-Client: travstats-mcp/<ver>` and
   `X-TravStats-Tool: <name>` headers, logged by the HTTP logger, so the user can see
   which tool wrote what in the change history. M3 (remote): a server-side per-tool
   audit table.
5. **Quota.** Client budget as in §2; the server's limiters remain the authority. A 429
   returns `rate_limited` with the retry-after, never a silent retry loop (max one retry).
6. **Failures as themselves.** Every non-2xx maps to a fixed reason (`auth`, `scope`,
   `not_found`, `rate_limited`, `disabled`, `timeout`, `server`) plus the server's code;
   an empty list means empty, not "failed".
7. **Server-chosen URL only.** The base URL comes from config, never from a tool argument,
   so a prompt-injected document cannot point the token at another host. Redirects are
   not followed.

## 6. Phases

| Phase | Scope | Tests |
|---|---|---|
| **M1** read-only, local stdio | package skeleton, config, token scope in `GET /auth/me` (server, additive), R1–R8, resources, redaction, admin refusal, version check | **Contract test:** each tool declares the `(method, path)` it wraps; CI generates `openapi.json` from the backend and fails if a path/method is gone or a used request/response field is missing or changed type. Unit tests per tool against a mock server that returns the spec's examples; semantic tests that a `null`+reason survives trimming, `onlyRecorded`/`purpose` are passed through, and an unknown token scope fails closed; error-mapping test per reason; redaction test; a smoke test against a dev server with a read PAT |
| **M2** write tools | W1–W6, `confirm` dry-run, client headers, audit log, prompts | Contract test extended to request bodies (the tool's Zod schema must be a subset of the operation's request schema); a test per write tool that it sends nothing without `confirm`; 403 with a read token surfaces as `scope`; W6 polling returns the run id on timeout |
| **M3** remote endpoint | `/api/v1/mcp` streamable HTTP reusing the M2 tool definitions as a library, PAT bearer, then OAuth 2.1 with PKCE and scope consent; beta key + admin switch (default off) | the same tool tests run against the in-process transport; `apiNoStore` and rate-limit tests cover the mount; OpenAPI coverage lists it in `UNDOCUMENTED_MOUNTS` with a reason or documents it; an OAuth flow test incl. revoked token |

The tool definitions are written once (transport-free core + stdio adapter) so M3 reuses
them rather than forking.

## 7. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Local package first, remote endpoint later? | Yes — (a) now, (b) only after M2 and only if you want claude.ai/mobile access. |
| Q2 | A token scope just for assistants (e.g. `mcp`, read + the six writes)? | Not now; `read` and `write` suffice. Revisit with OAuth in M3, where per-tool consent is natural. (Independent of this: M1 adds the token's scope to `GET /auth/me`.) |
| Q3 | Publish to npm (`npx travstats-mcp`) or only from the repo? | npm under the project's account, from the RC-first release flow, once M1 is green. |
| Q4 | May an assistant read raw TravTrack points? | No — day summaries only. Raw location history is the most sensitive data the server holds. |
| Q5 | Should the token-creation dialog warn that MCP data goes to the AI provider? | Yes, one sentence DE/EN, shown when a token is labelled for an assistant or always. |
| Q6 | Beta-gate the package? | No gate for a separate package (it only calls public routes); M3 gets a `betaFeatures` entry. |
| Q7 | Any write tool that deletes? | None in M2; deletes stay in the web UI. |

## Council

Codex (read-only second opinion on the recommendation, 2026-11-23):

> Supports local stdio + curated tools first and deferring remote hosting, but wants the
> transport-independent tool layer extracted now. "No added server surface" is fair; "no
> added attack surface" is not — local execution, dependencies, PAT storage and file
> access add risk. `confirm: true` is model-controlled, not proof of consent. W2 with an
> arbitrary `imagePath` is the sharpest risk. Draft parsing still sends data to an LLM and
> may cost money. Add a run follow-up for W6 and an item read before resolving; W5 needs
> kind-specific actions; W4 needs partial-success recovery; specify pagination, output
> caps, time zones and polling budgets. OpenAPI tests catch structural drift, not
> semantics — test ownership, purpose visibility, redaction, null reasons. Before a remote
> beta, follow the MCP authorization spec; PAT-only is not an interoperable path.

Adopted: W2 restricted to a configured directory; R9 `get_routing_run`; kind-specific W5
actions; W4 partial result; paging/caps/zones; polling 30 s with cancellation; the
`confirm` caveat and preconditions in §5; semantic tests below; OAuth already planned
for M3. Not adopted: a separate `get_inbox_item` (R7 already returns `why` per item;
revisit if accept decisions turn out uninformed). W1 note: the server's LLM parser is
an outbound AI call of its own, already behind the catalogue switch — the README says so
next to the provider disclosure.
