# Release readiness — 12 October 2026

Scope: the issue work merged into server `829753e3b` and Companion `315f2cb`,
plus the two fixes in this readiness branch. No deployment, restart, public
announcement, issue comment or issue closure was performed by this pass.

## Findings and fixes

1. **Dawarich scan takeover:** an upstream response arriving after another
   scan had acquired the expired lease could insert findings and overwrite the
   successor's result/lease. Finding inserts now lock and check the original
   reservation and current consent in one transaction. Success and error
   updates also match that reservation. No schema migration is needed.
2. **Dawarich settings recovery:** a failed polling request left an error
   visible after subsequent successful reads. Polling errors now clear on a
   successful read; a failed write remains visible despite a successful reload.

## Validation evidence

| Check | Result | What it establishes |
| --- | --- | --- |
| Dawarich API, detector, scheduler | 25 tests passed | 50 repeated scan cycles, including 10 upstream failures and expanded/truncated responses; rejection memory; 12 concurrent accepts; consent revocation; late success/failure after lease takeover; existing time-zone and visit matching cases |
| WebDAV over loopback HTTP | 10 scenarios passed, 22 requests | Real WebDAV client, PostgreSQL rows and temporary files; exact upload bytes; DELETE 401/423/500 keeps both copies and row; changed target sends no DELETE; lost response then 404 retry; upload 507; local-only/default and explicit remote retention; newest full archive protection; no cleanup without a full archive on disk |
| Backup and restore safeguards | 68 tests passed | Existing scheduler retention, backup/cloud deletion and restore preflight/migration guards |
| Real PostgreSQL archive restore | 6 tests passed | Actual pg_dump/psql; disposable databases only; old/current archives, migration history and triggers; failed mid-stream restore does not kill the backend |
| Dawarich settings/review UI | 7 tests passed | Recoverable polling failure versus persistent write failure, plus review behavior |
| Browser matrix | 12 combinations passed | DE/EN × 360/820/1440 px × Asia/Seoul/Pacific/Honolulu; bus day countdown, local review time, retained edits after conflict, own-connection gate, list failure not shown as empty, failed settings write, polling recovery, explicit remote deletion and retained dialog after failure |
| Companion full suite | 748 suites passed; 7,887 tests passed, 6 skipped | Notes, journal, sharing, year image preview, bus presentation and the rest of the app suite |
| Migration replay | No schema difference | The complete migration history reproduces schema.prisma in an isolated shadow database |
| Final static/build gates | Passed | Backend/frontend type checks, lint for changed source, formatting, file-size check and frontend production build |

The 50-cycle test is an accelerated repeat/failure test, not a claim of an
eight-hour unattended soak. Browser tests mount the production components and
styles with controlled API responses; they are not live-account tests. Screenshots
were inspected for the mobile review form and backup confirmation and retained
privately with the browser harness and logs. No screenshots contain real records.
The WebDAV fixture covers the protocol paths used here; it is not a certification
against every Nextcloud/WebDAV deployment.

The first backup test selection skipped six real restore cases because PostgreSQL
client executables were absent from PATH. Those six were then run successfully
using a temporary, matching PostgreSQL 15 client, without installing or restarting
services. They are included separately above, not counted as skipped final work.
Final cleanup verification found zero synthetic backup rows and zero leftover
restore databases. The frontend build retains the pre-existing map chunk-cycle
and large-chunk warnings; the readiness changes do not alter those modules.

## Open issue reconciliation

Trackers were read on 12 October: 3 open GitHub issues, 7 open server Forgejo issues,
6 open Companion Forgejo issues. The Discord scan found no new user report since
00:00 UTC on 12 October, only the existing RC bot announcement. Status below is
code/validation status; it does not assert that a fix has shipped.

| Reference | Current state | Next step |
| --- | --- | --- |
| GitHub #364 | Rail line re-fetch implemented and tested | RC acceptance, including provider failure / preserving an existing route |
| GitHub #366 | Backup retention implemented; unit and loopback scenarios pass | RC scheduled-backup acceptance with disposable archives |
| GitHub #367 | Explicit remote deletion implemented; real HTTP failure/retry scenarios pass | RC acceptance against the configured share using a disposable archive |
| forgejo#294 | Stay suggestions implemented; two additional readiness fixes above | Merge this branch, then RC opt-in/scan/review acceptance with an authorized test account |
| forgejo#146 / companion#28 | Server notes and Companion journal/sync integrated | Device acceptance: offline note, retry without duplicates, private/shared behavior |
| forgejo#154 | Share links and selected annual-card image export integrated | Native image/share-sheet acceptance on iOS and Android; field selection and revocation checks |
| companion#40 | Family flight share-link integration present | Verify expiry, last-known/schedule fallback and selected fields on a device and public view |
| companion#62 | Server bus upcoming entries now implemented with terminal times | Pair a new app build with the RC; confirm day-only/timed bus, widgets and current ride |
| forgejo#88 | Previous acceptance pass documented; registration sign-off and edge cache remain | Owner registration decision and explicit approval for the targeted Cloudflare change |
| forgejo#40 | Federation threat-model draft exists | Owner decisions/security review before implementation |
| forgejo#280 | Owner decisions/material tracker | Answer individual open items; routing item 14 is already resolved and must not be reimplemented |
| forgejo#59 | Ongoing file-size debt plan | Reduce while making substantive edits; not a new splitting project |
| companion#42 | CARTO key/style work deliberately deferred on 10 October | Preserve that decision; no key or style change |
| companion#37 | Voice notes deliberately deferred on 10 October | Recognizer choice and design before a native build |
| companion#9 | iOS HealthKit done; Android deliberately deferred | Measure actual ExerciseRoute availability on the test device before the Android adapter |

Live Activity companion#51 is already closed according to its acceptance comment;
it must not be reported as a still-unimplemented feature. Physical-device checks
remain useful, but cannot be performed by this headless workspace.

The unresolved items in forgejo#280 are specific inputs, not permission to change
infrastructure implicitly: whether odometer readings count as driven distance;
badge thresholds; a DB browser bookmarklet; which trip metadata synchronizes;
federation decisions; registration sign-off; a real redacted Sixt fee invoice;
confirmation of the legacy Google Places API configuration; and the missing China
travel documents. Later comments also ask about the private Companion GitHub
mirror, the targeted Cloudflare cache rule, NPM asset caching and whether cancelled
or not-yet-completed cruises contribute to certain statistics. The routing-provider
question was explicitly marked resolved in a later comment. No additional source
material or decision arrived during this pass.

## Release contents and migrations

- Backup keep-days cleanup after successful scheduled full backups; newest
  available full archive retained. Automatic remote cleanup is opt-in, default off.
- Explicit remote backup deletion with recorded target identity and safe failure
  handling. Old rows without identity require another upload before remote deletion.
- Rail geometry re-fetch, multi-leg distance display and operator presentation.
- Dawarich stay suggestions: own connection and separate opt-in, default off;
  every six hours at minute 15 UTC, last seven days; explicit reviewed acceptance.
- Bus upcoming entries with terminal-local day precision.
- Companion notes, journal, share links and annual image export.

Additive migrations already present on main:

1. `20261012122429_backup_retention_remote_identity`: one default-false admin
   flag and three nullable backup identity/error columns.
2. `20261012125349_dawarich_stay_suggestions`: scan/finding tables, indexes and
   user/visit relations. No import or confirmed visit is created by the migration.

The readiness corrections add no columns, external service, dependency or timer.
Do not regenerate connection secrets or enable either opt-in during rollout.

## RC acceptance and release gates — prepared, not executed

1. Obtain the separate main-merge decision for this readiness branch. Fetch both
   server remotes, reconcile any movement, re-run affected gates, fast-forward only.
2. Choose the next unused RC tag according to `docs/RELEASE_WORKFLOW.md`; do not
   reuse the rc.12 tag. Record source hashes and image digest in the release record.
3. Before an approved RC deployment, identify the actual RC target from current
   owner-approved inventory; do not infer its role from an old hostname. Preserve
   a verified full backup, uploads, current image digest, migration ledger and
   access to the existing encryption key. Never publish secret values.
4. Build and publish the reviewed image, then obtain explicit approval for the
   RC container replacement/restart. Any staging clone is a separate destructive
   action, not an implicit part of this readiness checklist.
5. After deployment, inspect migration/job errors, reported build version and
   health. Confirm new opt-ins remain off. Use a fresh test account to exercise
   Dawarich enable/scan/review/reject/repeat; original source evidence must remain
   visible. Test upstream outage and recovered status without creating extra visits.
6. Create disposable backup archives for retention/deletion acceptance. Do not
   use the operator's existing recovery copies for testing. Confirm the configured
   target and an unchecked remote-delete checkbox before the first deletion.
7. Pair the Companion build for notes, bus, public sharing and native annual-card
   export acceptance. Record iOS/Android build identifiers and results.
8. Promote, publish release notes, announce or close issues only under their
   respective authorization. This pass did none of those actions.

## Rollback / recovery plan

- Keep the pre-rollout image digest available. The new migrations are additive,
  so prefer disabling the new opt-ins and switching back to the prior image after
  explicit restart approval. Leave the new columns/tables in place; do not invent
  a destructive down migration. Validate old-image compatibility on RC before
  treating this as an approved production recovery procedure.
- If database recovery is necessary, first preserve post-upgrade writes and the
  current failed state for diagnosis. Restore a complete verified archive into
  an isolated recovery target, with the original encryption identity, and check
  migrations/triggers/uploads before any separately approved replacement.
- A restored database cannot resurrect a remotely deleted archive. That is why
  the newest full local archive remains protected and remote retention stays off
  unless explicitly enabled. Retain an independent known-good recovery copy.

## Re-running the local WebDAV verification

`backend/scripts/verify-webdav-local.ts` uses the actual application services.
Prepare a fully migrated disposable PostgreSQL database on localhost whose name
ends in `_test`, with an empty backup table. Keep its URL and a synthetic test
secret in a gitignored environment file. From `backend`:

```sh
node --env-file=.env.readiness-test --import tsx scripts/verify-webdav-local.ts
```

The script refuses non-local or non-test database names and existing backup rows.
It opens an ephemeral loopback HTTP port, creates only its own synthetic files/rows,
restores the previous test settings, and removes its own fixtures on exit. It does
not create a real database backup; the separate restore suite covers that path.
