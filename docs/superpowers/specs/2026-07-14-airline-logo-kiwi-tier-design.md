# Airline logos: a keyless tier that carries its own background

**Date:** 2026-07-14
**Status:** implemented (2026-07-15, branch `feat/airline-logo-kiwi-tier`)
**Rides:** 2.5.0, inside the `#189 + #191 + OpenFlights` block that closes the logo complex.

## The problem

2.5.0-beta.2 ships airline logos that the owner cannot read. Two defects, both
rooted in the same mistake.

The vendored keyless tier (`soaring-symbols`) ships **brand marks drawn in the
brand's own colour** — Lufthansa's crane is literally `fill="#05164d"`. A mark
like that needs a contrasting plate underneath. beta.1 painted the plate in the
brand colour and rendered navy on navy: invisible. beta.2 replaced that with a
luminance heuristic (dark mark → white plate). It is still wrong, because:

1. **The manifest is derived from brand metadata, not from the assets.**
   `vendoredBrands()` lists every airline that has a `branding.primary_color` in
   `airlines.json`. But **10 of the 93 airlines have no `logo.svg` at all** —
   Delta, Qantas, Thai, Air China, China Southern, EVA, Saudia, Air Astana, Air
   Dolomiti, Fiji. They are in the manifest, so `AirlineWordmarkCell` draws the
   56×56 brand tile for them; the backend finds no vendored asset and falls
   through to Daisycon, which returns a **wide wordmark that already carries its
   own background**. That wordmark is then squeezed into a square plate at 40px.
   Double background, letterboxed, wrong.

2. **No brand colour means no plate — even when the mark exists.** Iberia has a
   `logo.svg` but no `primary_color`, so it is absent from the manifest and gets
   no plate. Its SVG is drawn with `fill="currentColor"`, which inside an `<img>`
   has no context and falls back to **black**. Black mark, no plate, dark app
   background: invisible. This is exactly the owner's report.

The manifest promises a tile for airlines the vendored tier cannot serve, and
withholds one from an airline it can.

## The decision

Do not repair the plate logic. **Remove the need for it.**

`images.kiwi.com/airlines/<32|64|128>/<IATA>.png` returns a **finished square
brand tile that carries its own background** — Lufthansa white, Delta navy,
easyJet orange, Thai magenta. Measured 2026-07-14 against live endpoints:

| Source | Coverage (real logos, placeholders excluded) | Background? | Sizes |
|---|---|---|---|
| **kiwi.com** | **133/133** — all 93 vendored carriers **and** 40 regional/low-cost codes | **yes, baked in** | 32 · 64 · 128 |
| soaring-symbols (today) | 83/93 | no — needs our plate | SVG |
| Daisycon | ~90%, transparent unless `&color=` is passed | only with the param | any |
| avs.io (Aviasales) | 18/18 | no — transparent | any |
| logostream (premium) | **has gaps** (British Airways returns a placeholder) | yes | PNG |
| airhex, Clearbit | 0 — no longer answer keyless | — | — |
| Google/DDG favicon | 14/18, max 32px | no | 32 |

kiwi needs **no brand-colour metadata, no manifest, and no luminance
heuristic**. Both defects above stop existing rather than getting fixed.

Misses are detectable: an unknown IATA returns HTTP 200 with a **constant
placeholder image**. The codebase already handles exactly this shape for
Daisycon (`DAISYCON_PLACEHOLDER_MD5S`); the same md5 guard applies.

## Storage: on the server, self-updating

Owner's decision: neither hotlink-only nor repo-vendored. Logos are **fetched
once and stored on the server**, then served locally and kept fresh
automatically.

Half of this already exists. `logoCache.ts` writes `<key>.img` +
`<key>.meta.json` into `/app/data/cache/airline-logos` — a subdirectory of the
single data volume, so it already survives container updates. `resolveAirlineLogo`
already reads it first.

What is missing is the **freshness half**: a cache entry today has no
`fetchedAt` and no expiry, so a logo fetched once is served forever. An airline
rebrand would never reach an instance.

### The refresh contract

- `logoCache` meta gains three fields: **`fetchedAt`** (epoch ms of the last
  *successful* fetch), **`lastAttemptAt`** (epoch ms of the last attempt,
  successful or not) and **`source`** (which tier answered). Entries written
  before this change have no `fetchedAt` and are treated as **infinitely
  stale** — they refresh on first touch.
- **Stale-while-revalidate.** A read always serves the cached bytes
  immediately, even when stale. If the entry is older than `LOGO_MAX_AGE_DAYS`
  (default **30**), a background refresh is kicked off and the *next* request
  gets the new bytes. A user request never waits on a refresh, and a dead
  upstream never blocks a page.
- A background refresh that fails leaves the entry's bytes **and its
  `fetchedAt` untouched**, and writes only `lastAttemptAt`. Staleness is
  therefore always measured from the last *success*, while the retry backoff is
  measured from the last *attempt*: a failing upstream cannot make a stale entry
  look fresh (which would let the nightly sweep skip it forever), and cannot
  trigger a refresh storm either. A stale logo beats no logo.
- **Scheduled sweep**: `src/jobs/airlineLogoRefreshScheduler.ts`, modelled on
  `historicalEnrichmentScheduler.ts` (node-cron, UTC — see the timezone note in
  `CLAUDE.local.md`). Runs nightly and re-fetches entries whose `fetchedAt` is
  past the max age and whose `lastAttemptAt` is outside the retry backoff.
  Sequential with a small delay between fetches, so a cold instance with a few
  hundred cached codes does not hammer kiwi in one burst.
- **Admin action**: `POST /admin/airline-logos/refresh` + a status poll, mirroring
  the existing `POST /admin/airports/reseed` pattern (`routes/admin/system.ts`,
  `adminReseedLimiter`). Surfaced in the admin UI next to the airport re-seed.

## Architecture

### Resolution chain (`resolveAirlineLogo`)

Ordered by what each tier costs the instance. Every tier returns `null` on a
miss and falls through — **never a placeholder**. That invariant already holds
and must survive this change.

1. **logostream** — premium. Only runs where an admin configured a key. Best
   quality, but *not* complete (BA is missing).
2. **kiwi.com** — NEW. The keyless default. Finished brand tile.
3. **Daisycon** — the tail net, for carriers even kiwi does not know. Unchanged.

The vendored `soaring-symbols` snapshot **stops being a wordmark tier** and
becomes the **icon tier**: `icon.svg` / `icon-mono.svg` for compact surfaces
(rankings, chips, map popups, mobile), where a wide mark does not fit. The
mono variant needs no plate at all. This was the owner's idea and it holds.

### Frontend

`AirlineWordmarkCell` renders the resolved image directly at the tile size. It
no longer:

- reads a manifest to decide the tile shape,
- computes `isDark(brand.color)` to pick a plate,
- branches on whether a brand colour exists.

The text fallback (airline name, then flight number) stays: it is what shows
when *every* tier misses.

### What gets deleted

- `GET /airline-logos/manifest` and `useAirlineLogoManifest`.
- `vendoredBrands()` and the `VendoredBrand` type (the brand-colour map).
- `isDark()` and the plate logic in `AirlineWordmarkCell`.
- The `logo` / `logo-white` variants of `getVendoredLogo` — the vendored
  snapshot keeps only `icon` / `icon-mono`.

The `refresh:airline-logos` vendoring script and `backend/data/airline-logos`
stay, but only the icon assets are consumed. Dropping the unused `logo*.svg`
files from the snapshot is a follow-up, not part of this change.

## Error handling

- kiwi unreachable → tier returns `null` → falls through to Daisycon → text
  fallback. A page never breaks on a logo.
- kiwi placeholder (unknown IATA) → md5 guard → treated as a miss, negative-
  cached, falls through.
- Cache write failure → logged, request still served from memory. The cache is
  an optimisation, never a dependency.
- Corrupt cache entry → `getCachedLogo` already returns `null` on any read
  error, which re-fetches. Unchanged.

## Testing

- **Unit**: the kiwi tier returns `null` for the placeholder md5; returns bytes
  for a real logo; the chain falls through in the right order; a `null` from one
  tier never becomes a placeholder.
- **Cache freshness**: an entry with no `fetchedAt` is stale; one within
  `LOGO_MAX_AGE_DAYS` is fresh; a stale read serves the old bytes *and* triggers
  exactly one background refresh; a failing refresh leaves both the bytes and
  `fetchedAt` intact and writes only `lastAttemptAt` — assert explicitly that a
  failed refresh does **not** make the entry look fresh, because that bug would
  silently freeze a logo forever.
- **Scheduler**: picks only entries past the max age; skips entries still inside
  the retry backoff; spaces its fetches out.
- **Frontend**: `AirlineWordmarkCell` renders the image with no manifest present
  (the manifest hook is gone); falls back to the name when the image 404s.
  The existing plate assertions get deleted, not adapted — they encode the bug.
- **Browser UAT** on the beta, against the real dark background. A green unit
  test proved nothing here last time: every assertion passed while the logo was
  invisible on screen. Screenshot the flights table before claiming success.

## Out of scope

- The airline/aircraft master-data tables (#189) and the flights admin page
  (#191). This spec is the logo half of that block and lands first; the catalogue
  work builds on top and is specced separately.
- Pruning the unused `logo*.svg` files from the vendored snapshot.
- Any change to the premium tier beyond leaving it first in the chain.
