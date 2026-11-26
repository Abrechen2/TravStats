# Trip photo links — plan

Owner request (2026-11-26, relayed by Worktravel): every big trip gets its photos linked, never copied; work trips link their time window; show everything that exists, with 3–4 thumbnails and a "more" control; nothing goes into the inbox.

Measured on prod (2026-11-26): 4 of 214 trips carry photos. Example: the three Münster trips have none, although 200–444 photos per trip exist, mostly in a second PhotoPrism (unraid-2) that is not connected.

## Decisions

1. **A trip-level period link** sits next to album links. The source is `{provider, connectionId, from, until}`. The dates come from the trip and follow it when the trip dates change, unless the user pinned them. It stores zero bytes and streams through the existing asset proxy, like album link mode. Per-entry windows (rc.45 `tripPhotoWindows`) remain for entries; the trip view unions all of them.
2. **Several photo connections per account.** Today an account holds one Immich and one PhotoPrism (`photoprismBaseUrl`/`immichBaseUrl` columns). A new `photo_connections` table (provider, label, base URL, encrypted token, isShared, egress rules exactly as forgejo#411 Immich) lets a second PhotoPrism (unraid-2) be added. The existing columns migrate to one row each; the old columns are read as a fallback for one release and then dropped in a later plan entry.
3. **Album proposals on the trip page, not in the inbox.** The match uses name tokens, date overlap (album photo time span against trip dates) and folder names such as `2017_Münster`. It shows as a one-line hint on the trip ("Passendes Album: 2017_Münster (323 Fotos) — verknüpfen?"), with link / not this one (remembered). Nothing links without the click.
4. **Work trips:** if no album matches and the trip's purpose kind is business, the trip page offers "Zeitraum verknüpfen" as one click. A global setting "Zeitraum automatisch verknüpfen für Reisen ohne Album" (default off) may do it for all.
5. **Display, replacing the 5–10 cap of 2026-11-21:** the cap applied to copying and auto-linking. Linked photos are only references, so the trip, entry and roadtrip views show 3–4 thumbnails plus "+N weitere", which opens the shared lightbox gallery (feat/photos-lightbox) with day grouping and lazy loading.
6. **Several sources for one period:** they are merged and de-duplicated by capture instant (±2 s) plus dimensions, else by a perceptual-hash prefix if the provider exposes one. If they do not merge, the preferred connection wins (the user orders the connections; the default is the first one added).

## Contract (additive; minimum server 2.8.0-rc.47)

- `GET/POST/DELETE /api/v1/photo-connections` (+ `/test`). Fields: id, provider, label, baseUrl, isShared, status. The token is write-only. Error kinds as the Immich vocabulary.
- `GET /api/v1/trips/:id/photo-sources` lists album links and period links, each `{id, kind: album|period, provider, connectionId, from?, until?, pinned, count?}`.
- `POST /api/v1/trips/:id/photo-sources` takes `{kind:"period", connectionId, from?, until?}` or `{kind:"album", connectionId, albumId}`. `DELETE …/:sourceId`.
- `GET /api/v1/trips/:id/photo-sources/proposals` returns album candidates `{connectionId, albumId, name, count, overlapDays, reason}`; `POST …/proposals/:key/dismiss`.
- `GET /api/v1/trips/:id/photos?cursor=&day=` is the merged, de-duplicated, paged list (assets only, streamed via the proxy).
- Companion: reads the same endpoints; no change needed for old app versions.

## Phases

| Phase | Server | Web | Companion |
|---|---|---|---|
| P1 | photo_connections + migration of existing connections; period links; merged trip photo list | trip "Fotos" card: 3–4 thumbs + more → lightbox; manage sources | — |
| P2 | album proposals (name/date/folder) | one-line hint on the trip with link/dismiss | — |
| P3 | business trips: period link offer + optional global auto setting | settings switch | show linked photos (later hand-over) |

## Owner decision (2026-11-26)

The second PhotoPrism (unraid-2) is NOT connected: only the owner's own Cardinal sources (PhotoPrism + Immich). Decision 2 (photo_connections) is therefore deferred; P1 uses the existing single Immich and PhotoPrism connections.

## Was open for the owner

- Connect the second PhotoPrism (unraid-2, his mother's library) to his account: a credential is needed (Infisical `travstats/prod /ops`: `PHOTOPRISM_UNRAID2_URL`, `PHOTOPRISM_UNRAID2_TOKEN`, created as CHANGE_ME once he agrees).


## Owner decision 2 (2026-11-26): PhotoPrism is the source of truth

PhotoPrism holds ALL photos; Immich holds only the phone photos (a subset of the same pictures). So:
- Period links and album proposals use **PhotoPrism only** by default. Immich is not queried for periods, so the same photo never shows twice.
- Existing Immich album links stay valid and keep working; the trip view de-duplicates them against PhotoPrism (capture instant ±2 s plus dimensions) and prefers the PhotoPrism asset.
- A per-account setting "Bevorzugte Fotoquelle" (default PhotoPrism when both are connected) makes this explicit; other instances with only Immich keep using Immich.
