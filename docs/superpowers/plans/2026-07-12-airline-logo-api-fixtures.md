# Airline logo API — logostream.dev contract (empirically pinned)

Probed 2026-07-12 against the live API using the key from `backend/.env`
(`LOGOSTREAM_API_KEY`, masked below as `<KEY>`). No real key value appears
in this file.

## TL;DR — the confirmed contract

Neither candidate from the task brief was the real image endpoint. The
actual image host was discovered indirectly (see "How it was found" below).

| Constant | Value |
|---|---|
| `LOGOSTREAM_BASE` | `https://airlines-api.logostream.dev` |
| Path (ICAO) | `/airlines/icao/{ICAO}` |
| Path (IATA, also works) | `/airlines/iata/{IATA}` |
| Auth mechanism | Query string `key=<KEY>` (**not** a header — `x-api-key` is a *different* product's auth, see below) |
| Variant param | `?variant=icon\|logo\|logo-white\|tail` (omitted or unrecognized → silently falls back to `icon`) |
| Success content type | `image/png` for all four variants |
| Unknown-airline behaviour | **200 OK**, `image/svg+xml` placeholder (never 404) — see below |

Example request template:

```
https://airlines-api.logostream.dev/airlines/icao/DLH?variant=logo&key=<KEY>
```

## How it was found

Both candidates from the brief failed to return a real logo:

- **Candidate A** (`https://aviation-api.logostream.dev/v1/airline-logo?iata=LH&variant=icon`, header `x-api-key`) → **404** `{"error":"Unknown endpoint: /v1/airline-logo"}`. This host is a *different* product ("Aviation Data API" — airlines/airports/routes/stats, no logos) with its own `x-api-key` header auth, confirmed via its self-describing root endpoint (`GET /` → `{"name":"Aviation Data API","version":"v1","endpoints":[...]}`, no logo endpoint in the list).
- **Candidate B** (`https://api.logostream.dev/airlines/iata/LH?variant=icon&key=<KEY>`) → **200**, `image/svg+xml`, but the body was an identical generic placeholder (`<text>...IAT</text>` or `<text>...AIR</text>` depending on the exact path/query used) for *every* input tried (`LH`, `BA`, `Q9`, no params at all, wrong variant). This host answers every request the same way regardless of the airline code — it is not a working logo route for this key/plan, or the route shape is wrong. Not used further.

The real host was found by querying candidate A's own metadata product for
an airline record: `GET https://aviation-api.logostream.dev/v1/airlines?iata=LH`
(header `x-api-key: <KEY>`) returns full airline metadata including a
`logo` object with pre-built URLs:

```json
"logo": {
  "icon": "https://airlines-api.logostream.dev/airlines/icao/DLH?key=<sample-key>",
  "logo": "https://airlines-api.logostream.dev/airlines/icao/DLH?variant=logo&key=<sample-key>",
  "logo_white": "https://airlines-api.logostream.dev/airlines/icao/DLH?variant=logo-white&key=<sample-key>",
  "tail": "https://airlines-api.logostream.dev/airlines/icao/DLH?variant=tail&key=<sample-key>"
}
```

That revealed the real image host (`airlines-api.logostream.dev`, note:
**third** hostname, distinct from both brief candidates) and the real path
shape (`/airlines/icao/{ICAO}`). The `key=` in that response was a sample
free-tier key baked into the metadata API's example output (its own
literal value is intentionally omitted from this doc — treat any embedded
API key value as a secret regardless of source), not ours — it was
discarded; our own `LOGOSTREAM_API_KEY` was substituted and confirmed to
work identically.

## Per-variant results (ICAO `DLH`, IATA `LH` = Lufthansa passenger)

All requested with `https://airlines-api.logostream.dev/airlines/{icao|iata}/{CODE}?variant=<V>&key=<KEY>`.

| Variant | Status | Content-Type | Size | Dimensions | `X-Asset` header |
|---|---|---|---|---|---|
| `icon` | 200 | `image/png` | 6449 B | 200×200 | `DLH_icon` |
| `logo` | 200 | `image/png` | 2800 B | 200×77 | `DLH_logo_bg` |
| `logo-white` | 200 | `image/png` | 2437 B | 200×35 | `DLH_logo_white` |
| `tail` | 200 | `image/png` | 6061 B | 200×155 | `DLH_tail` |
| (omitted) | 200 | `image/png` | 6449 B | 200×200 | `DLH_icon` (defaults to `icon`) |
| `bogus` (unrecognized value) | 200 | `image/png` | 6449 B | 200×200 | `DLH_icon` (silently falls back to `icon`, no error) |

Both addressing modes return the identical asset for the same airline:

- `GET /airlines/icao/DLH?variant=icon&key=<KEY>` → `X-Asset: DLH_icon`, `X-Lookup: skipped` (direct hit, no resolution step)
- `GET /airlines/iata/LH?variant=icon&key=<KEY>` → `X-Asset: DLH_icon`, `X-Lookup: skipped` too (IATA `LH` resolves straight to the passenger carrier `DLH`, not e.g. `GEC`/Lufthansa Cargo or `LIT`/Lufthansa Italia, both of which also carry IATA `LH` per the metadata API — the image API picks one canonical mapping per IATA code).

Caching: `Cache-Control: public, max-age=31536000, immutable` on all known-airline responses (`X-Cache: KV`, `X-Source: TwicPics` — backed by a Cloudflare-fronted image CDN).

## Unknown-airline behaviour

**Never 404.** Any code the API doesn't recognize (bad IATA, bad ICAO,
garbage input) still returns **200 OK** with a dynamically generated
`image/svg+xml` placeholder — a colored square with the (truncated,
uppercased) input code rendered as text. The placeholder is **not** a
fixed/constant asset — both the fill color and the text content vary per
input code, so there is no single stable MD5 to pin.

**Update (2026-07-12, same day, verification phase):** End-to-end testing
revealed that the Daisycon placeholder itself (for the same code and
dimensions) is **not byte-stable across render generations**. Three
distinct MD5 hashes have been observed for the identical visual placeholder
PNG, indicating backend re-renders or CDN cache invalidations over time.
As a result, the MD5-based filter in the proxy's
`DAISYCON_PLACEHOLDER_MD5S` set can never be exhaustive — new unknown-airline
codes may arrive with unobserved MD5 hashes, slip through the filter, and
get disk-cached as if they were real logos. This is cosmetic-only (users
saw the same placeholder PNG before the proxy existed) and unobservable in
production (only reachable for airlines logostream doesn't know). The filter
is treated as BEST-EFFORT and will be extended incrementally as new hashes
are encountered:

| Input | Status | Content-Type | Size | `X-Asset` | Body (placeholder SVG) | MD5 |
|---|---|---|---|---|---|---|
| `iata=Q9` (garbage) | 200 | `image/svg+xml` | 265 B | `-` | `fill="#1F2853"` … `<text>Q9</text>` | `96311784596dabd9a136333a667054b8` |
| `icao=ZZZZ` (garbage) | 200 | `image/svg+xml` | 266 B | `-` | `fill="#084059"` … `<text>ZZZ</text>` | `460305bde733245401990f34feef14a0` |

### Observed Daisycon placeholder PNG render generations (cosmetic filter)

These MD5 hashes represent the same visual 300×150 placeholder PNG across
different Daisycon backend render generations (2026-07-12 / 2026-07-XX / 2026-07-XX):

| Generation | MD5 |
|---|---|
| 1 | `e868e45186e3f2e758f42dcd1029da2d` |
| 2 | `fdbd908af301103989b2373c18c170a5` |
| 3 | `9722f0e8186537a02ca39846f7b4cf7b` |

Implication for the proxy (Task 4+): a 200 response is **not** sufficient
to detect "known airline" — must check `Content-Type` (`image/png` =
real logo, `image/svg+xml` = unknown-airline placeholder) or the
`X-Asset` header (`-` = unresolved).

## Auth failure modes (query-string `key=`)

| Case | Status | Content-Type | Body |
|---|---|---|---|
| Missing `key` param entirely | 401 | `application/json` | `{"error":"Missing API Key."}` |
| Invalid/garbage `key` value | 403 | `application/json` | `{"error":"Invalid API Key."}` |

## Notes for Task 4

- `LOGOSTREAM_BASE = "https://airlines-api.logostream.dev"`
- Path template: `` `${LOGOSTREAM_BASE}/airlines/icao/${icaoCode}` `` (prefer ICAO addressing — it's a direct hit per `X-Lookup: skipped` and avoids the IATA→multi-airline ambiguity noted above for shared IATA codes like `LH`)
- Auth: append `?key=${LOGOSTREAM_API_KEY}` (and `&variant=...` as needed) to the query string — this is **not** a header.
- Distinguish "no logo for this airline" from "network/auth error" by checking `Content-Type` on a 200, not just the status code.
- The `aviation-api.logostream.dev` host (different product, `x-api-key` header, JSON metadata) is unrelated to logo serving and out of scope for the proxy — do not use it.
