# Answers to the 2026-09-09 audit

Written by the verifying pass, for the auditor. Every finding below was
reproduced independently before being fixed, and every fix carries a test that
fails against the unfixed code — the control probe is stated where the result
was not the obvious one.

Branch: `fix/audit-2026-09-09`. Target release: 2.6.3.

## Fixed

AUD-001 … AUD-008, AUD-011 … AUD-042, except the six discussed below.

Two of them deserve a note because the first attempt was wrong:

- **AUD-002 (bootstrap race).** Moving the admin count inside the transaction
  did NOT stop it — four concurrent registrations still produced four admins,
  and an isolated probe with longer transactions aborted only three of four.
  It is now a `pg_advisory_xact_lock`.
- **AUD-003 (session revocation).** A timestamp-based check failed: `iat` has
  second resolution, so a session issued in the same second as the password
  change survived. It is a `sessionEpoch` counter.

## Deliberately not fixed

### AUD-009 — the encryption key is not in the backup

**Owner decision, 2026-09-10: leave as is.** Putting the key into the archive
would place the key and the ciphertext it opens in the same file, which is the
one thing the encryption exists to prevent. Where the key lives, and how it is
backed up, is an operator decision — `/app/data/secrets/` is documented and can
be captured separately, under whatever protection the operator actually has.

This is not a disagreement with the finding's facts: a restore into a fresh
instance without that directory does lose the encrypted values, and that is
worth documenting more loudly than it is today. It is a documentation item, not
a change to what the archive contains.

### AUD-010 — the scheduler runs neither retention nor WebDAV sync

**Owner decision, 2026-09-10: leave as is, for now.** The finding is correct
about what the scheduler does. But wiring retention cleanup and WebDAV sync into
it is a FEATURE — new behaviour on a schedule, touching remote storage — and
shipping it would make the next release 2.7.0 rather than the 2.6.3 this branch
is aimed at. It stays on the board rather than in this fix round.

## The four that change numbers already on screen

These were held back and put to the owner explicitly, because each rewrites
figures a user has already seen. All four were approved on 2026-09-10 and are
fixed on this branch:

- **AUD-018** — chronology now compares instants, and the merged end state of a
  partial update is validated. Westward flights are accepted; London 10:00 →
  Berlin 10:30 is refused.
- **AUD-022** — one shared create-field mapping for both write paths, and the
  batch takes the same FX snapshot (resolved outside the transaction). The
  parity test compares the two stored rows field by field rather than against a
  hand-written list, because a hand-written list is how they drifted.
- **AUD-023** — a booking whose amount could not be converted no longer
  contributes its distance or hours to the denominator.
- **AUD-024** — one bounds rule for the edit path, the explicit recompute and
  the sweep: what the trip HOLDS wins, its own dates are the fallback, and the
  two are never mixed.

## Found while verifying, not on the list

**The `AdminSettings` singleton is not enforced.** No uniqueness constraint,
eleven read-else-create sites, and forty-odd bare `findFirst()` reads that
Postgres answers in physical order. Two concurrent first-writes on a fresh
instance produce two rows, and from then on an admin saves a setting on one page
while another page reads the other row. The audit's own test database held
**four** rows, which is what made `lodgingCurrencyEndToEnd` red.

Every read is ordered now and creation goes through one advisory-locked
accessor. Merging rows an instance already has is deliberately NOT done: which
of two divergent settings rows is the real one is a question only the operator
can answer, and a migration that guesses would delete configuration.

## One note on method

AUD-019's first test passed against the unfixed code. Account B's flight POST
was rejected by the flight schema, so B held no reference at all and the 404 the
test asserted proved nothing. It now asserts the flight was created and that the
reference was stored, and only then that the fetch is refused. Worth stating
because the same shape — a negative assertion that holds because the setup
failed — is the easiest way for any of these tests to look green and mean
nothing.
