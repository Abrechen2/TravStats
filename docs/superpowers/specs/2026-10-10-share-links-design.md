# Public share links — design and threat model

Tracks `dennis/TravStats` forgejo#281 (owner decision **D7**, 2026-10-01, recorded in
forgejo#154, companion#39, companion#40). Branch `feat/share-links-281`.

> One share-link model for share cards, Trip Wrapped and the family flight link — opt-in per
> item, expiring, revocable, behind an instance switch that is off by default.

**Not this:** sharing a trip between two accounts on the same server
(`2026-10-09-trip-sharing-design.md`, `routes/sharing.ts`) and server-to-server federation
(`2026-10-10-federation-threat-model.md`). A share link is the one place where a person's travel
data leaves the instance's authentication entirely: **anyone holding the URL reads what the
owner chose**. Everything below follows from that sentence.

The federation draft's stance carries over in spirit: what crosses the boundary is decided by
a **schema built field by field**, never by "the record minus a few columns"; abstention is a
result; the instance admin can switch the whole surface off.

---

## 1. What a link is

A `PublicShareLink` row: owner, `kind` (`flight` | `trip` | `wrapped`), exactly one target
(`flightId` | `tripId` | `year`), the owner's `fields` selection, `expiresAt`, a SHA-256 of
the token, and — for trips with photos — the ids of the photos the owner saw in the preview.

| kind | target | what it is for |
|---|---|---|
| `flight` | one of the owner's flights | the family flight link (companion#40): phase and ETA from the schedule, optionally the last position the phone sent |
| `trip` | one of the owner's trips | the share card and Trip Wrapped (companion#39, forgejo#154) |
| `wrapped` | a calendar year | the yearly recap |

### 1.1 Field allow-list per kind (server-side, the only source of the payload)

The public serializer builds an **explicit DTO from the chosen fields only**. A field that is
not chosen is absent from the JSON — not null, not empty — so the response cannot be read for
"what exists but was hidden".

| kind | field | public payload |
|---|---|---|
| all | `owner` | the owner's first name (never the username, never the last name) |
| flight | `flightNumber` | airline name, flight number |
| flight | `route` | departure and arrival airport: IATA/ICAO code, name |
| flight | `schedule` | scheduled departure and arrival as `TimeValue` (ADR 0002) |
| flight | `progress` | phase (`scheduled` / `inFlight` / `landed` / `cancelled` / `unknown`), progress 0–1, ETA as `TimeValue` — from the schedule, a reported actual time wins |
| flight | `aircraft` | aircraft type text — never the registration |
| flight | `lastPosition` | last point of the phone's uploaded recording (lat, lon, time) — present only when a recording exists, i.e. the owner has "Flugwege an den Server senden" on; `null` otherwise |
| trip | `name` | trip name |
| trip | `dates` | first and last day (`LocalDateValue`) |
| trip | `totals` | flights, flight km (great-circle), cruises, rail rides, countries count, days |
| trip | `countries` | ISO codes of the trip's countries (the trip page's own rule) |
| trip | `route` | ordered legs: flight airport codes, rail station names, cruise ports — codes and names only, no times |
| trip | `costs` | the trip's total in the owner's base currency (the trip page's figure) |
| trip | `companions` | companion display names |
| trip | `photos` | up to 12 photos (count + per-photo index), bytes through the photo proxy |
| trip | `notes` | the owner's standalone notes marked `shareable` whose day falls in the trip (forgejo#146, `2026-10-10-note-visibility.md`): text, place name, moment — at most 50, re-read on every request; a private note is never listed |
| wrapped | `totals` | flights, km, earth factor, new countries, cruises, rail rides/km |
| wrapped | `topAirline` | name and code of the year's most-flown carrier |
| wrapped | `topRoute` | the year's most-flown pair |

**Never, whatever is chosen:** seat, booking reference, ticket number, PNR, frequent-flyer
number, price per flight, the notes fields of entries and trips, private standalone notes,
journal text, documents, photo captions, photo coordinates,
EXIF, co-passenger names parsed from mails, aircraft registration, internal ids (user, flight,
trip, photo), the username, other accounts. These are not fields — there is no way to ask
for them.

## 2. Threat model

| # | Threat | Defence | Test |
|---|---|---|---|
| T1 | **Link leakage via logs** — access logs of nginx, of a reverse proxy in front (NPM, Cloudflare), of the app's own request logger | The token lives in the URL **fragment** (`/share#<token>`). A fragment is never sent to any server, so it reaches no access log, no proxy, no CDN. The page's script sends it in a POST **body**; the request logger records body *keys* only (`bodyKeys`), never values. `requestPathForLog` additionally redacts any token-shaped path segment, should one ever appear in a path | `shareLinks.logging.test.ts` |
| T2 | **Link leakage via Referer** | Fragment is never part of a Referer. The page sets `Referrer-Policy: no-referrer` and loads nothing from another origin | headers test |
| T3 | **Link leakage via chat/screenshots** — unfurl bots of messengers fetch a pasted URL | An unfurl bot fetches `/share` without the fragment and gets an empty shell: no title, no data, no image. The owner sees the link exactly once and the UI says that anyone holding it can read it. View counter on the owner's list makes unexpected spread visible. Revocation is one click | page test (shell carries no data) |
| T4 | **Enumeration / guessing** | 256-bit token from `crypto.randomBytes`; only `SHA-256(token)` is stored (a 256-bit secret is not brute-forceable offline, so bcrypt adds nothing — the pairing-code design); lookup by the hash's unique index, then a constant-time compare. **Every failure is the same 404** — malformed, unknown, expired, revoked, switch off, target gone — so a guesser cannot learn that a token ever existed. Per-IP rate limit on resolution (`ipKeyGenerator`, /56 for IPv6) | uniform-404 test, limiter test |
| T5 | **Stale caches after revoke** | Every data and photo answer is `Cache-Control: no-store` (the `/api` default stays), the HTML shell too. The page polls; a 404 clears what it shows. Expiry is re-checked on **every** request, never cached | revoke test, expiry test |
| T6 | **Scraping** | Per-IP limits on view and photo; photos capped at 12 per link; no listing endpoint exists for the public | limiter test |
| T7 | **Instance switch flipped off with links outstanding** | Switching off **deletes every link** in the same request, and resolution checks the switch first anyway. On again starts from nothing — an admin who switched off because of an incident does not get the old links back | switch test |
| T8 | **Data the owner did not choose** | Field allow-list per kind (§1.1), explicit DTO builders, a per-kind test with a fixture full of sensitive values asserting none of them appears | `shareLinks.allowList.test.ts` |
| T9 | **Photo leakage** — a client-supplied id reaching another photo; EXIF GPS in the bytes | Photo proxy keyed by link + index into the photo ids snapshotted at creation (never a client-supplied id); each id is re-checked to still belong to the link's trip and owner. JPEG/PNG bytes are **rebuilt from an allow-list**: the format is decided by magic bytes (a stored type that disagrees → not served); JPEG keeps SOI, SOF/DHT/DAC/DQT/DRI/DNL, every SOS with its entropy data (walked to the next real marker, so segments between progressive scans are filtered too), APP0 only as JFIF, APP2 only as ICC, and stops at the first EOI — appended motion-photo MP4s, gain maps and MPF secondary images with their own Exif are dropped; orientation is kept as a minimal Exif block; PNG keeps IHDR/PLTE/IDAT/IEND/tRNS/gAMA/cHRM/sRGB/iCCP/sBIT/pHYs/bKGD and nothing after IEND; a malformed or truncated stream is not served at all; other types are not served | photo test, stripper test |
| T10 | **Search engines** | `X-Robots-Tag: noindex, nofollow, noarchive` on page, data and photos; `<meta name="robots">` in the shell | headers test |
| T11 | **Tracking of the viewer** | No third-party resources (CSP `default-src 'none'`), no cookies set, no IP stored. The owner sees a view **count** and last-view time only | — |
| T12 | **Instance user list / private app shell** | The page is a self-contained server-rendered shell and one script; it does not boot the SPA, does not call `/auth/me`, `/setup/status` or anything else that names users | page test |
| T13 | **Public demo account** creating public links | `rejectDemo` on create | create test |
| T14 | **Resurrection by restore** — a backup taken before a revoke | `afterDatabaseRestore` deletes every link; a restored instance starts with none | restore test |
| T15 | **Item or account deleted** | Foreign keys with `ON DELETE CASCADE` on user, flight and trip; a year has no row. A wrapped link whose year has nothing left answers 404 | lifecycle test |
| T16 | **Long-lived flight links** | A flight link expires at `min(expiresAt, arrival + 2 h)`, re-computed on each request from the flight's current times — a delay moves the end, a landing ends it | expiry test |

### Residual risks (stated, not solved)

- **Whoever holds the URL is the audience.** Forwarding cannot be prevented, only made visible
  (view count) and ended (revoke, expiry).
- A **compromised browser** of a recipient, or a screenshot, keeps what was shown.
- The **instance admin** can read the rows; the token is not recoverable from them.
- The page needs **JavaScript** (the fragment is only readable client-side). Without it the
  page says so and shows nothing — no data is ever server-rendered into HTML.
- A **position** shown on a flight link is wherever the phone last had Wi-Fi; it can be stale
  and the page shows its age.

## 3. Wire contract

### Owner (authenticated, enveloped `{success, data}`, ADR 0001)

- `GET /api/v1/share-links` → `{ enabled, links: [...] }` — the switch state and the caller's
  active links (no token, it is not stored). Each link: `id, kind, target, fields, expiresAt,
  effectiveExpiresAt, createdAt, viewCount, lastViewedAt`.
- `POST /api/v1/share-links/preview` `{ kind, targetId, fields }` → `{ view }` — exactly the
  payload the public will see, built by the same serializer.
- `POST /api/v1/share-links` `{ kind, targetId, fields, expiresInDays }` (1–90 days from the server clock),
  or `{ kind, targetId, fields, expiresAt }` for an absolute timestamp; exactly one expiry form → `{ id, url, token,
  expiresAt, effectiveExpiresAt }`. `url` is `<public base>/share#<token>`. **Shown once.**
  409 `SHARE_LINKS_DISABLED` while the switch is off; 404 for a target the caller does not
  own; 400 for an unknown field, an expiry in the past or beyond 90 days; 409
  `SHARE_LINK_FLIGHT_LANDED` for a flight that has already landed; 409
  `SHARE_LINK_LIMIT` at 50 active links.
- `DELETE /api/v1/share-links/:id` → 200; the URL answers 404 from that request on.

`targetId` is a string for every kind: the flight or trip id, or the year as `"2026"`.

The switch also rides on `GET /api/v1/settings` as read-only `shareLinksEnabled`, like
`openDataEnabled`, so the Companion offers the share sheet only when the server allows it.

### Public (no authentication, enveloped)

- `GET /share` — the HTML shell (plus `/share/share.js`, `/share/share.css`).
- `POST /api/v1/public/share-links/view` `{ token }` → `{ kind, expiresAt, view }`.
- `POST /api/v1/public/share-links/photo` `{ token, index }` → image bytes.
- Every failure: `404 { error: "Not found", code: "SHARE_LINK_NOT_FOUND" }`.
- Left out of the `CORS_ORIGIN` refusal and given no CORS headers: the page that asks is served by
  this same server, and an instance reached under a name `CORS_ORIGIN` does not list refused every
  link with 403 (found in the browser check). A foreign page still cannot read the answers.

## 4. Why a server-rendered shell, not a route in the SPA

The SPA's `index.html` boots the private app: it calls `/auth/me`, the setup status and the
settings, redirects to the login, and pulls the app's chunks. A public page inside it would
either run all of that for strangers or need exceptions threaded through the shell. Its
headers are also nginx's, shared with the app (`Referrer-Policy: strict-origin-when-cross-origin`,
cacheable assets). A tiny page served by Express under `/share` has its own headers per
response (no-store, no-referrer, noindex, a CSP stricter than the app's: `default-src 'none';
script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'`), no inline
script, works the same in dev and in the container, and is testable with supertest. nginx gets
one `location ^~ /share` that proxies to the backend.

## 5. Lifecycle

| Event | Effect |
|---|---|
| Account deleted | links deleted (FK cascade) |
| Flight / trip deleted | its links deleted (FK cascade) |
| Instance switch turned off | every link deleted |
| Backup restored | every link deleted |
| Export (`/admin/export/all-data`) | links listed without the token hash |
| Sync feed | not carried — the Companion reads the list endpoint when it opens the share sheet; a link is not travel data |

### Public-link settings and clock handling (15 October 2026)

The instance-wide switch is under **Administration → Instance → Public links**.
Personal settings keep the user's link list and revocation controls; administrators
get a direct link to instance administration. Disabled-state messages name this location.
The web dialog sends a relative lifetime for every expiry choice, including
“Until landing (+2 hours)”. The server derives the timestamp from its own clock
and retains the 90-day limit and dynamic arrival-plus-two-hours cap. Existing
clients supplying an absolute `expiresAt` remain supported with the same limits.
