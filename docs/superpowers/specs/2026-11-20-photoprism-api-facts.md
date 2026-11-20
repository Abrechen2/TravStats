# PhotoPrism API facts (phase B0, measured 2026-11-20)

Measured against a throwaway container `photoprism/photoprism:latest`
(version string `261029-963b58c50-Linux-AMD64-Plus`, SQLite, password auth,
three JPEGs with EXIF in one album, plus one JPEG without GPS and one without
any EXIF). Container, network and volumes were removed afterwards. Companion to
section B.2 of `2026-11-20-photoprism-trip-merge-trip-places.md`.

## Confirmed as written in B.2

- REST under `/api/v1`; `Authorization: Bearer <app password>` works. An app
  password is created with `photoprism auth add -n <name> -s "<scope>" <user>`
  (the UI "App passwords" does the same) and looks like `xxxxxx-xxxxxx-xxxxxx-xxxxxx`.
  Without a token or with a wrong one: `401 {"code":401,"error":"Please log in to your account"}`.
- Photos of an album: `GET /photos?s=<albumUID>&count=N&offset=M`. Paging is
  reported in headers `X-Count`, `X-Limit`, `X-Offset` (there is no total).
  A page shorter than `count` is the last one; offset past the end answers `200 []`.
  `album=<uid>` and `q=album:<slug>` also work.
- A photo carries `UID`, `TakenAt`, `Lat`, `Lng`, `Hash`, `Type`, `Width`,
  `Height`, `FileName`, `TimeZone`. `Hash` is the hash of the primary file and is
  what `/t/` and `/dl/` take.
- Thumbnail `GET /t/<hash>/<previewToken>/<size>` answers `image/jpeg`
  (sizes tried: `tile_224`, `tile_500`, `fit_720`, `fit_1280`, `fit_2048`).
  Original `GET /dl/<hash>?t=<downloadToken>` answers the original file.
- Version: `GET /api/v1/config` field `version`.

## Differs from B.2 or was not stated there

1. **Albums need `count` and `type`.** `GET /albums?type=album` without `count`
   is `400 {"error":"Unable to do that"}`; `GET /albums?count=10` without `type`
   is `403 {"error":"Permission denied"}` (no `code` field). Always send both;
   `count` of 0 is 400. `count=5000` is accepted (no visible cap).
2. **The two tokens come from `GET /api/v1/config`, not from a session**, and only
   when the app password's scope allows it. `GET /session` with an app password is
   `403`. Scopes measured: `albums photos files` alone gives a config WITHOUT any
   token (thumbnails then cannot be built); scope `config` alone gives
   `previewToken` only; `albums photos files config` gives both. **The setup text
   must tell the user to grant `albums photos files config`** (or `*`).
3. **`/config` is public** (200 without a token) and carries `version`, but no
   tokens. So the `test()` call can read the version anonymously, and a token
   problem shows up only on `/albums` (401) or as a missing token field.
4. **Preview token** is 8 characters, identical for every client and every call,
   and unchanged across a container restart. Nothing measured made it rotate; treat
   it as long-lived and re-read it when `/t/` answers 403.
5. **Download token** is `<expiryUnix>.<hex>.<hex>` (about 125 chars), expiry 3600 s
   after issue. Every `/config` call mints a new one; older ones stay valid until
   their own expiry and are reusable (not single use). Cache for well under an hour.
6. **Bad or missing tokens answer `403`, not 401**, with an `image/svg+xml` body of
   301 bytes (a placeholder icon, status 403). Bearer on `/t/` or `/dl/` instead of
   the URL token is also 403. The proxy must key on the status, never on the content
   type, and must not forward that SVG as an image.
7. **`TakenAt` is UTC; `TakenAtLocal` is the wall clock but carries a `Z`.**
   `TimeZone` names the zone (`Europe/Lisbon`). Use `TakenAt` + `TimeZone`.
   A photo with no EXIF date gets the file's modification time as `TakenAt`
   (`TakenSrc` empty instead of `meta`). `TakenSrc` is the way to tell them apart.
8. **No GPS is `Lat: 0, Lng: 0`**, not null. Mapping this to "no position" is the
   adapter's job (abstention rule); a real 0/0 is open sea.
9. **List results carry no `Files` array** (it is `null`); only the single-photo
   `GET /photos/<uid>` has `Files[]` with `Hash`, `Primary`, `Mime`. List-level
   `Hash` is enough for thumbnails and downloads.
10. Responses of `/photos` carry `Cache-Control: no-store`.
11. `GET /albums` items: `UID`, `Title`, `Slug`, `Type`, `PhotoCount`, `Thumb`
    (hash of the cover), `CreatedAt`. `PhotoCount` was correct (3) after adding.
12. Order of an album's photos with no `order` param was newest first in the
    unfiltered list; send `order=oldest` explicitly where order matters.
