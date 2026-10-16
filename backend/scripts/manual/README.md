# Manual verification scripts

Scripts in this folder are run **by hand**, against disposable local
resources. They are not part of the Jest suite and CI does not execute them;
CI only typechecks them (`npm run typecheck:manual`, `tsconfig.manual.json`),
so an API change in `src/` that breaks one fails the build instead of leaving
the script to rot.

## `verify-webdav-local.ts`

Exercises WebDAV backup sync with the real `webdav` client over real loopback
HTTP, real files and real `backups` rows: upload bytes, DELETE answered
401/423/500, a changed target, a lost DELETE response, a failed upload, local
and opt-in remote retention, and the "no full archive on disk" guard
(10 scenarios).

It cannot run under Jest: `webdav` is ESM-only and `jest.config.js` maps it to
`src/__mocks__/webdav.ts` for every suite. The unit-level behaviour of the same
services is covered by the Jest suites under `src/services/__tests__/`.

Prepare a fully migrated PostgreSQL database on localhost whose name ends in
`_test`, with an empty `backups` table, and keep its URL plus a synthetic
`ENCRYPTION_KEY` in a gitignored env file. From `backend/`:

```sh
node --env-file=.env.readiness-test --import tsx scripts/manual/verify-webdav-local.ts
```

The script refuses a non-local or non-`_test` database and existing backup
rows, creates only its own synthetic files and rows, restores the previous
WebDAV settings and removes its fixtures on exit.
