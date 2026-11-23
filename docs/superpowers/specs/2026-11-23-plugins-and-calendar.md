# Suggestion plugins and a calendar source (owner, 2026-11-23)

Status: **plan for the owner's decision; no code before his OK.**

Builds on `2026-11-21-travtrack-visit-suggestions-v2.md` (TravTrack stops become
place-visit findings in the stay inbox) and `2026-11-22-private-business-purpose.md`
(the `purpose` field, shipped in 2.8.0-rc.44).

## Owner's request

The owner visits customer sites for work. Two sources already know every visit: an
employer-side project archive (a database reachable online with an API key; name,
street, postcode, town and a coordinates column per project, whose precision
varies by row) and a work calendar whose event titles carry a visit type code. He wants
TravStats to notice by itself: TravTrack sees a stop, a project at that place or a
calendar event at that time matches, and the stop becomes a business visit with the
right name.

TravStats is public. Nothing employer-specific may enter it, so the request splits
into two generic features any user can use, plus a private plugin outside the repo.

## 1. The split

| Part | Where | Why |
|---|---|---|
| A. Calendar source (ICS URL / CalDAV), read-only, per account | TravStats | Everyone has a calendar; "meeting at Musterstraße 5, 10:00" is evidence for a stop in any job or hobby |
| A. Keyword/calendar → purpose rules | TravStats | Generic mapping, the user writes the rules |
| B. "Externe Vorschlagsquellen": signed HTTPS plugin endpoints that answer a stop with suggestions | TravStats | Generic extension point; TravStats knows nothing about what is behind the URL |
| B. Plugin guide + sample plugin template | travstats.de docs + public template repo | Lets anyone build one |
| The owner's plugin: project-archive lookup, address geocoding cache, title-code parsing | Private repo on Forgejo only, own container | Employer data, schema and API key |
| The concrete archive name, table, URL, key and test data | Private repo + Infisical | Never in TravStats, not even in a spec or a test fixture |

Rule for every later change: if a field, constant or test fixture only makes sense for
one employer, it belongs in the plugin, not in TravStats.

## 2. Part A — calendar source

### Connection

- New catalogue entry `calendar` in `services/externalServices/catalogue.ts`,
  category `photosLocation` (or a new `personal` category, see Q3), level `account`,
  credential `urlKey`-style: either an **ICS subscription URL** (the iCloud/Google
  "secret address", which is itself the credential and stored encrypted like an API
  key) or **CalDAV** (server URL, user, app password, chosen calendar collections).
- **Off by default** — personal data (owner rule 2026-11-15). Subject to the internet
  master switch like every catalogue service (`assertEgressAllowed("calendar")`).
- Egress follows forgejo#411 (`services/egress/privateTargets.ts`): an ordinary
  account's URL must resolve to public addresses (checked on save, on `/test` and on
  every fetch, DNS pinned); the admin's own connection, the admin-global tier and ENV
  may reach the LAN (a self-hosted Radicale/Nextcloud). No redirects followed.
- Several calendars per account (iCloud "Arbeit" and "Privat" are separate ICS URLs
  or CalDAV collections). Each carries a user label.
- Test button: fetch, parse, answer `{ ok, events, from, to }` or one of the fixed
  failure kinds `notConfigured | unreachable | auth | notFound | protocol |
  invalidUrl` (same vocabulary as Immich, mapped to DE/EN copy).

### Reading, without keeping the calendar

- A job (`services/jobs/jobRegistry.ts`) reads only a **window**: the days the visit
  scan currently looks at (today − lookback .. today, max 30 days) plus explicit
  backfill ranges. CalDAV uses a `time-range` REPORT; ICS is fetched whole (no other
  way) and filtered in memory, recurring events expanded with an RRULE library
  inside the window only. Size cap (e.g. 5 MB) and parse-time cap per fetch.
- **Nothing is stored except matched evidence.** The parsed events live in memory for
  the duration of the job. An event that matches a stop is written into that
  finding's `evidence.calendar`: `{ sourceId, uidHash, title, start, end, location,
  geocoded?: {lat, lon, precision}, rule? }`. Unmatched events leave no trace — no
  event table, no cache of titles. The `uidHash` (HMAC of UID + account) only lets a
  rejected finding stay rejected.
- Times: events carry their own TZID; all-day events are local dates in the profile
  zone (ADR 0002 — through `shared/time/`, never host-local).

### Matching events to stops

A stop (from `deriveDay().whole`, as in V2) and an event match when:

1. **Time:** the event's span overlaps the stop's window by ≥ 50 % of the shorter of
   the two, or the stop starts within ± 60 min of the event start (a visit often
   overruns its slot). All-day events match only with a location (step 2).
2. **Place** (one of):
   - the event location geocodes (geocoder service, own cache keyed by the normalised
     location string, failures kept apart from "no result") to within 300 m of the
     stop;
   - the location text matches the name of an own place or the venue V2 already found
     (normalised substring / token match);
   - no location, but a keyword rule names a place ("Kunde X" → place id) — optional.
3. Without a place match an event is **context only**: it can set purpose and propose
   a name for a stop that has no venue, but it never moves a stop to a different
   place. The evidence says which of the three it was.

Geocoding failures follow the four defect classes: a geocoder failure leaves the day
owed (as V2 does for Overpass), never "no match".

### Rules → purpose and name

Per account, ordered, first match wins:

- **calendar rule:** calendar label "Arbeit" → `purpose: business`;
- **keyword rule:** title contains/starts with a token (case-insensitive, word
  boundary) → purpose and an optional name template (`{title}`, `{location}`,
  `{titleAfterToken}`).

Defaults: none. Without a rule an event proposes a name but no purpose (unknown stays
unknown — "abstention is a result").

### Reuse

- Findings stay `dawarich_stays` rows, provider `travtrack`; the calendar adds
  `evidence.calendar` and may set `evidence.suggestedPurpose`. No new inbox.
- Accepting writes the place visit as today, plus `PlaceVisit.purpose` from the
  suggestion (the user can change it in the accept dialog).
- A stop V2 would not suggest (no venue, address only) **is** suggested when a
  calendar event with a place match exists — that is the business-park case.

## 3. Part B — external suggestion sources (plugins)

### Registration

Per account, list under Settings → Integrationen → "Externe Vorschlagsquellen"
(EN "External suggestion sources"):

- `name`, `url` (HTTPS only; plain http only for an admin's own LAN target, see
  egress), `secret` (generated by TravStats, 32 bytes, shown once, stored encrypted;
  rotate button), `precision` (`exact` | `100m` | `1km` — coordinates are rounded
  before they leave), `enabled`, `autoAccept` (off), `minConfidence` for auto-accept
  (default 0.9), `backfillAllowed`.
- Catalogue entry `suggestionPlugins` (account-level, off by default, own switch,
  under the master switch). A plugin row is a connection like Immich's.
- Max 5 plugins per account.

### Request (TravStats → plugin)

`POST <url>` with JSON, contract version in the path-independent header:

```http
Content-Type: application/json
TravStats-Plugin-Version: 1
TravStats-Timestamp: 1763900000
TravStats-Signature: v1=<hex HMAC-SHA256(secret, "POST\n" + path + "\n" + timestamp + "\n" + requestId + "\n" + body)>
TravStats-Request-Id: <uuid>
```

```json
{
  "version": 1,
  "kind": "stop",
  "requestId": "…",
  "stop": {
    "start": "2026-11-23T08:12:00Z",
    "end": "2026-11-23T10:40:00Z",
    "timeZone": "Europe/Berlin",
    "lat": 48.69,
    "lon": 9.31,
    "precisionMeters": 100,
    "nearestPlace": { "name": "…", "distanceMeters": 40 } ,
    "venue": { "name": "…", "category": "…" },
    "address": { "street": "…", "postcode": "…", "town": "…", "country": "DE" }
  },
  "locale": "de"
}
```

Never sent: raw track points, the account's id/username/email, other stops, other
entries. `nearestPlace`/`venue`/`address` are optional and only what the account
already derived for that stop (address from reverse geocoding, only at `exact` and
`100m` precision).

### Response (plugin → TravStats)

`200` with

```json
{
  "version": 1,
  "suggestions": [
    {
      "name": "…",
      "address": "…",
      "lat": 48.6901,
      "lon": 9.3102,
      "purpose": "business",
      "note": "…",
      "externalRef": "…",
      "url": "https://…",
      "confidence": 0.95
    }
  ]
}
```

- Zod-validated; every field but `name` and `confidence` optional; max 5 suggestions,
  strings length-capped, `url` must be `https:` (rendered as a plain link with
  `rel="noopener noreferrer"`, never fetched by TravStats), `purpose` only
  `private | business`, `confidence` 0..1. `204` or `[]` = "nothing here" (a real
  answer, recorded as such). A suggestion more than 1 km from the stop is dropped and
  logged (a plugin cannot move a stop across town).
- Errors are their own reasons: `timeout`, `unreachable`, `auth` (401/403), `rateLimited`
  (429, honours `Retry-After`), `protocol` (bad JSON/schema, unknown major version),
  `server` (5xx), `privateTarget`. Shown per plugin in settings ("letzter Fehler")
  and in the scan job result; the day stays owed for that plugin only.

### Where suggestions land

- Merged into the same `dawarich_stays` finding of that stop as
  `evidence.plugins[]: { pluginId, pluginName, …suggestion, receivedAt }`. The inbox
  card shows the best candidate with "Quelle: <Pluginname>" and lets the user pick
  another candidate (venue, calendar, plugin). The place page lists the source of an
  accepted visit ("vorgeschlagen von …").
- Accepting creates/links the place with `externalRef = plugin:<pluginId>:<ref>` (so a
  second visit finds the same place) and sets `purpose`.
- **Auto-accept** (per plugin, off by default): only when `confidence ≥ minConfidence`,
  the suggestion is within 300 m, and no other source disagrees on the place. It
  writes a visit marked `provenance: plugin` and an entry in the change history with
  a one-click **undo** (removes the visit; deletes the place only if this accept
  created it and nothing else references it). Auto-accept never runs on a backfill.

### Limits

- Timeout 5 s per call (connect 2 s), one call in flight per plugin per account,
  max 60 calls per plugin per hour and 300 per day; backoff after failures like V2
  (15 min doubling to 6 h). Response body cap 64 KB.
- Called once per stop per plugin; the answer (including "nothing") is recorded so a
  rescan does not ask again unless the stop changes by > 300 m or the user presses
  "neu fragen".

### Egress

As forgejo#411: ordinary accounts → public addresses only, checked on save, on
test and on every call with DNS pinned through the guarded lookup; the admin's own
plugin may reach the LAN (a plugin container next to TravStats). No redirects.

### Versioning

`version` is an integer major. TravStats sends the highest it speaks; the plugin
answers with the version it used; an unknown major is `protocol`. Additive fields
inside a major are allowed both ways and must be ignored when unknown. The settings
page shows the version each plugin answered last. `GET <url>` (signed the same way)
is an optional health/hello: `{ name, version, kinds: ["stop"] }`, used by the
test button.

### Test button

Sends a signed `kind: "test"` request with a fixed synthetic stop (a public square,
no account data) and shows the outcome kind, latency, answered version and the first
suggestion.

### Backfill

"Vergangene Tage abfragen" per plugin: a date range of max 90 days, run as a job,
bounded by the same hourly/daily limits (it simply takes longer), stops already
answered are skipped, results are suggestions only (never auto-accepted).

## 4. Plugin guide

- **Where:** `travstats.de/docs/plugins/` (TravStatsWeb, DE + EN) and a public
  template repository `travstats-plugin-template` (GitHub + Forgejo).
- **Contents:** what a plugin is and is not (it answers, it never writes into
  TravStats); the request/response contract above as JSON Schema
  (`contract/v1.schema.json`, also exported from the server's OpenAPI so the two
  cannot drift); signature verification (constant-time compare, ±300 s timestamp
  window, a mandatory request-id replay cache); privacy expectations (do not log coordinates
  longer than needed); errors and `Retry-After`.
- **Minimal Node example** (≈60 lines, no framework):
  `node:http` server → read raw body → verify `TravStats-Signature` with
  `crypto.timingSafeEqual` → parse → look up → answer JSON. Plus a Python variant if
  cheap.
- **Deploy:** `Dockerfile` (node:alpine, non-root, read-only FS), `compose.yaml`
  snippet joining the TravStats network, secret via env, health endpoint; a test
  script that replays a signed sample request.
- **Branding:** the docs page and template README carry the `<abrechen2 />` credit.

## 5. The owner's private plugin (outside TravStats, Forgejo only)

Repository `dennis/travstats-plugin-work` (name open), never mirrored to GitHub.
Built on the template. Concrete archive name, table, URL, field names and sample
data live only in that repo's README; the API key and the plugin secret live in
Infisical (project of the plugin, root `/`, rendered into its env file).

- **Project lookup:** load the archive's projects (name, street, postcode, town and
  its coordinates column) via its REST API. **The archive's own coordinates come
  first** (owner correction 2026-11-23: the "whole degrees only" note may have been an
  export artefact or a different column). Per row a precision check decides: a
  coordinate with ≥ 4 decimals on both axes counts as usable; a missing coordinate,
  one with fewer decimals, or one that looks like whole degrees (both values
  integral, or 0/0) is geocoded once from street/postcode/town instead (own geocoder
  or Photon). Cache `{projectId, addressHash, lat, lon, source: archive|geocoded,
  precision, geocodedAt}` in a small SQLite file; re-geocode only when the address
  changes. The plugin logs how many rows used each source, so the first run shows
  whether the column is really usable.
- **Match:** projects within ~300 m of the stop, nearest first; confidence from
  distance and geocode precision (house number match → high, street/town only →
  low). Answer `name = project name`, `address`, `purpose: business`,
  `externalRef = project id`, `url` to the archive record if one exists.
- **Calendar title codes:** if the owner wants the work calendar in the plugin rather
  than in Part A, the plugin reads it itself and parses the visit-type codes in the
  title into the `note` (commissioning / maintenance / re-optimisation) and boosts
  confidence when the title names the project. Recommendation: use Part A for the
  calendar (it is generic) and keep only the code parsing in the plugin, by a
  keyword rule per code in Part A or as `note` from the plugin.
- **Reuse:** the Worktravel session's matching and trip-building scripts (from its
  2026-11-22 handover) already do address matching and calendar parsing in Python;
  port the matching rules and the tested thresholds rather than re-deriving them.
- Runs as a container next to the owner's TravStats (admin account → LAN allowed).

## 6. Phases

| Phase | Scope | Tests (each fails without the change) |
|---|---|---|
| P1 | Calendar source: catalogue entry, ICS + CalDAV connection, egress, test button, fixed failure kinds, DE/EN copy | catalogue/egress tests (private target refused for ordinary account, allowed for admin's own); ICS parser (TZID, all-day, RRULE expanded only in window, size cap); test-button failure kinds |
| P2 | Event ↔ stop matching, rules, evidence on findings, purpose on accept | matcher truth table (overlap, ±60 min, 300 m, text match, context-only); "no event stored except matched" (DB has no event rows after a scan); geocoder failure keeps the day owed; accept writes `purpose` |
| P3 | Plugin registry + signed call + response validation + inbox merge | HMAC fixture vectors; schema rejection cases (http url, >5, far suggestion); each failure reason surfaces; rounding per precision; no account identifiers in the body |
| P4 | Auto-accept with undo, backfill job, limits | auto-accept only above threshold and never on backfill; undo removes visit and only a self-created place; rate limit and `Retry-After` |
| P5 | Guide on travstats.de, template repo, contract schema export | template's own test replays a signed request; OpenAPI ↔ `v1.schema.json` equality test |
| P6 (private) | Owner's plugin | its own tests in its repo, thresholds from the Worktravel data |

Companion: no change needed; findings arrive through the existing inbox endpoints
(additive evidence fields).

## 7. Open questions (with recommendations)

1. **Calendar in Part A or only inside plugins?** Recommend Part A: generic, and the
   evidence rule (store only matched events) is easier to hold in one audited place.
2. **Auto-accept at all in v1?** Recommend shipping P1–P3 first; P4 after a month of
   watching suggestion quality on the owner's account.
3. **Catalogue category** for the calendar: reuse `photosLocation` or add
   `personal`. Recommend a new `personal` category (calendar is neither).
4. **Plugins per account or per instance?** Recommend per account, with an admin
   switch to disable the feature instance-wide. An admin-global plugin offered to all
   users is out of scope.
5. **Push from plugins** (a plugin proposing visits without a stop, e.g. from the
   archive alone)? Recommend no: plugins answer stops; anything else is an import.
6. **Precision default:** recommend `100m`; `exact` is opt-in per plugin.

## 8. Security review points

- Calendar URLs and plugin secrets are credentials: encrypted at rest, never echoed
  back (only "gesetzt"), never logged, excluded from exports/backup plaintext as the
  other connection secrets are.
- SSRF: forgejo#411 rules on every fetch with DNS pinning; no redirects; response size
  and time caps; ICS parsing bounded (event count, RRULE expansion count).
- Signature: HMAC over timestamp + body, ±300 s window, request id for replay
  protection on the plugin side; TravStats does not need to verify plugin responses
  beyond TLS (the plugin is the user's own choice) but treats them as untrusted input
  (Zod, caps, no HTML, link-only URLs, distance check).
- Data minimisation: rounded coordinates, no tracks, no identifiers; the settings
  page states exactly what is sent ("Was gesendet wird").
- Auto-accept is bounded (threshold, distance, never backfill) and always undoable.
- Rate limits on the settings/test endpoints (`userOrIpKey`), and the outbound limits
  above so a slow plugin cannot tie up the job queue.
- Public-repo hygiene: no employer names, URLs or sample data in TravStats code,
  specs, fixtures or tests.

## Council

Gemini was asked as briefed but returned HTTP 503 ("high demand") on three attempts;
Grok had no credits; Codex is limited until 26.11. The second opinion therefore came
from **GitHub Copilot CLI** (read-only, no tools), 2026-11-23. Its points and what the
plan does with them:

- **Bind the signature to more than timestamp + body** (method, path, request id) and
  require replay rejection on the plugin side. *Adopted:* the signed string is now
  `POST\n path \n timestamp \n requestId \n body`; the guide makes the request-id
  replay cache mandatory, not optional.
- **Matched calendar evidence still identifies the user** (title, location).
  *Adopted:* when a finding is rejected or the visit is accepted, `evidence.calendar`
  is reduced to `{sourceId, uidHash, start, end}`; the title survives only in what the
  user accepted (the visit's name/note). Deleting the calendar source deletes its
  evidence on open findings.
- **Cap ICS/CalDAV parsing harder** (event count, RRULE expansion, XML depth,
  decompression). *Adopted* into the P1 tests: caps on events (10 000), expansions per
  rule (500), decompressed size, CalDAV XML depth.
- **Show why a match was made** (overlap, place match vs context only); purpose/name
  changes only on accept. *Already in the plan;* the inbox card names the match kind.
- **Define disagreement for auto-accept** (conflicting names, purposes, places).
  *Adopted for P4:* "disagree" = another source (venue, calendar, other plugin) names a
  different place > 300 m away or a different purpose; any disagreement blocks
  auto-accept.
- **Persist "nothing here" and invalidate on stop change.** *Already in the plan*
  (§3 Limits).
- **Version via `Accept`/media types, compatibility matrix, canonical JSON.**
  *Not adopted:* an integer major plus ignore-unknown-fields is enough for a
  one-endpoint contract; the signature is over the exact body bytes, so no canonical
  JSON is needed.
- **Ship P1–P3 without auto-accept, with a kill switch.** *Matches Q2;* the instance
  switch for the catalogue entry is the kill switch.
