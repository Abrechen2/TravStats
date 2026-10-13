# Friend comparisons — DEV #40

Branch: `dev/federation-40`. Experimental, beta-gated, no deployment. Entry point:
`/comparison` under More. UI and help text are available in German and English.

## Implemented

- Multiple independent friends, same-instance or across explicitly admitted HTTPS servers.
  Single-use 72-hour invitation, bilateral comparison-code confirmation, no data by default.
- Directional grants for statistics, records, costs, personal content, photos and documents.
  Preview and explicit consent; domain/trip/year scope, precision, expiry and future-trip choice.
  “All supported data” explicitly selects all six categories. Credentials are never shareable.
- Private friend lists and metric-selectable leaderboards with ties, unavailable values and
  coverage/freshness metadata. Partial, rounded or incompatible observations receive no rank.
- Shared groups of up to 20 people. The named host assembles group-authorised statistics.
  Members see the full audience before approval. Membership changes invalidate grants and
  require renewed approval. Personal grants never supply group data.
- Source-side authorisation on every read/download, persistent nonce replay protection,
  signed requests/responses, pinned Ed25519 keys, public-IP-only HTTPS egress, rate/size/time
  limits and metadata-only access audit. Remote records are not imported or stored locally.
- Restore hook disables peers, grants and friendships and consumes invitations before reuse.

## Current coverage and limits

This is the first DEV implementation, not full parity with every TravStats view:

- 21 scalar metrics cover flights, cruises, lodging, rail, bus and rentals. Flight costs use
  the existing base-currency summary. Countries are lifetime-only; unsupported combinations
  of trip/domain filtering return unavailable rather than an unfiltered aggregate.
- Record browsing covers all nine domains with explicit scalar-field allowlists and pages of
  100 records. Cost, personal and booking fields require their additional category grants.
- Trip details/files use the existing trip exporter and category-specific field projection.
  Rich map/track geometry, external Immich assets and every nested analysis are not covered.
  New fields do not silently inherit old consent. No side-by-side map is implemented yet.
- Downloads are explicit, up to 5 MiB each, and use attachment filenames with octet-stream
  content. A year-limited grant permits filtered scalar records, but not whole-trip/file reads
  whose contents could span other years. Files require all visible domains in the trip scope.
- Fixed selections support up to 500 trips. “Existing only” freezes trip membership and the
  creation-time cutoff for unfiled records; existing records can still receive corrections.
  It is not an immutable historical snapshot.
- Reads are live/on demand, without scheduled refresh or durable foreign-data cache.
  Revocation stops future authorised reads; it cannot erase screenshots/downloaded copies.
- Group hosting is an explicit trust boundary: the host receives group statistics and enforces
  the roster. This intentionally replaces the original full-mesh, no-relay proposal. Every
  roster change requires renewed consent, including for remaining members.

## Enabling in a DEV environment

Local friendships require the instance beta flag and authenticated cookie sessions. Personal
API tokens are rejected. Cross-instance exchange additionally requires the following on each
server (examples only; no real host addresses or credentials belong in this document):

```dotenv
FEDERATION_ENABLED=1
FEDERATION_PUBLIC_ORIGIN=https://travstats.example.org
FEDERATION_KEY_FILE=/secure/travstats/federation-ed25519.pem
```

Generate an Ed25519 private key on the target host using `openssl genpkey -algorithm ED25519`,
write it to the configured absolute path with mode 0600, outside uploads and database backups.
Do not print, commit or share the private key. Apply the Prisma migrations through the normal
DEV deployment process. Restart/deployment still requires the owner's separate approval.

In Server connections, each admin pins the other server's origin/public key, compares the
fingerprint out of band and verifies the connection. Only then exchange user invitations.
HTTP, private/loopback/link-local destinations, redirects and unverified peers are rejected.
Do not weaken the address policy to test over LAN. Use mocked transport or public HTTPS DEV
origins with synthetic accounts. No production data is needed.

Experimental endpoints live under `/api/v1/comparison` (cookie session, beta gate) and
`/api/v1/comparison-peer` (signed peer envelope, beta gate). No public user search/directory.
Keys are external to the database. Supported application restore calls the suspension hook;
manually restoring SQL or cloning a whole machine must also disable federation and re-enrol
peers before exposing the clone. The automatic hook cannot intercept external restore tools.

## Validation

Validated against an isolated local test database, without touching existing user databases:

- Backend permissions, invitations/concurrency, record scope, membership/version invalidation,
  route authentication, signatures/address policy, restore suspension and API response guards.
- Frontend ranking, explicit preview/consent, locale parity, beta gating and navigation.
- Backend/frontend TypeScript checks, targeted lint, schema drift and file-size checks.
- Chromium screenshots of the real comparison page with synthetic API fixtures at desktop and
  mobile sizes. This is a UI smoke test, not proof of a real multi-server exchange.

Still required before release: real two-server HTTPS testing (including offline peers and key
rotation), independent security review and normal integrated release checks. No full production
build or live federation deployment was performed in this task.
