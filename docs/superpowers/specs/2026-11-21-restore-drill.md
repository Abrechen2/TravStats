# Restore drill, 2026-11-21

Question (council, 2026-11-21): does a TravStats backup restore COMPLETELY, not just "a file exists"?
Method: a local throwaway stack only (own Postgres databases, the worktree's own `uploads/`); never the RC server or prod.

## What was run

`backend/src/services/backup/__tests__/restoreRoundTrip.test.ts` (now part of the suite):

1. Seeds one account with: a flight, cruise, lodging + stay, rail, bus, ferry, rental, trip, place + visit, a note with a photo,
   companions (+ a flight link), expenses with a receipt, a profile picture, user settings, 25 TravTrack points + a privacy zone,
   a share link, and kept documents with files on disk: a trip document with one `primary` and three `covers` links
   (provenance `user` / `parser` / `suggestion` / `legacy`), a rental document with `rentalCategory = pickup`, plus one document
   per other owner kind and one unfiled original. Photos: uploaded and Immich-linked trip photos, an uploaded, an Immich-linked and
   a trip-photo-linked place-visit photo, a lodging photo.
2. Takes the backup the way the app does (`createBackup`: `pg_dump` + `uploads.tar.gz` + `metadata.json`).
3. Deletes every seeded upload file, creates a SECOND, freshly migrated database, registers the archive there (as a WebDAV import or
   a copied archive does) and runs `restoreBackup(scope: "full")` — the code behind the admin's restore.
4. Compares: row count + md5 of every row of every public table (196 tables); sha256 of every restored upload file; every document's
   bytes against the `sha256` its row recorded; `document_links` field by field; TravTrack order and the `seq` sequence continuing.

Positive control: with `documents` removed from `BACKED_UP_UPLOAD_DIRS` the file and sha256 tests fail.

## Result

No gap in the database or upload path. Everything that differs after a restore does so on purpose and is asserted:

| Table                        | Why it differs                                                      |
| ---------------------------- | ------------------------------------------------------------------- |
| `_prisma_migrations`         | applied again on the fresh database                                 |
| `backups`                    | the machine keeps its own backup rows                               |
| `public_share_links`         | emptied by every restore (forgejo#281)                              |
| `sync_changes`, `sync_state` | the phones' change feed restarts, epoch bumped                      |
| `admin_settings`             | instance identity (URLs, rpId, push id, federation key) stays local |

All other tables: identical. Document files, trip/place/lodging photos, receipts, note photo, avatar: identical sha256.
`document_links` identical (role, provenance, `rentalCategory`, every target). TravTrack points in order, next point continues `seq`.

Tables the seed leaves empty are covered structurally only (the dump is one whole-database `pg_dump`; `travtrack.backup.test.ts`
holds that nothing narrows it), not by content.

## Second path: account export (`/me/export`, `/admin/export/all-data`, WebDAV sync)

JSON metadata only. It carries every record (documents with `storedName`/`sha256`, photos with `filename`, TravTrack in its own
section) but NO file bytes — no document, receipt or photo — and nothing in TravStats can read it back (stated in
`allDataExport.ts`). It is a human-readable copy, not a recovery path: an account moved with it would arrive without a single file.
Filed as an issue (see below).

## Outside the archive, by design

- `/app/data/secrets` (encryption key, JWT secret). A restore onto a host with different secrets is refused unless the admin
  accepts the key change; then every stored API key, SMTP password and Immich/Dawarich token has to be entered again. Disaster
  recovery therefore needs the secrets saved separately; the backup UI could say so. Owner decision, not changed here.
- Regenerable caches (airline/provider/operator logos, subject images, route store), logs, the TravTrack import spool.

## How to run the drill by hand

`DATABASE_URL=… npx jest src/services/backup/__tests__/restoreRoundTrip.test.ts --forceExit` needs `pg_dump` and `psql` on PATH (CI has
them; the suite fails in CI without, skips locally). It builds `<db>_rt_src` and `<db>_rt_fresh` beside the configured database and drops
them afterwards. Note: it writes to and deletes its own marker files under `backend/uploads/` (the restore path is fixed).
