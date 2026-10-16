# Dawarich stays: independent use and clear states

## Goal

The existing detection from the user's own Dawarich data is completed; no
second detection is created. Prod is not affected for now. A suggestion stays
a guess; only a confirmation writes a visit. The source is Dawarich, not
automatically GPS: imported photo positions can sit in the same history. No new
sharing of data with an external geocoding service.

## Behaviour under different kinds of use

| Configuration | Behaviour |
| --- | --- |
| Dawarich only | The user's own connection and own consent are enough. Immich is neither needed nor enabled. |
| Immich only | Unchanged photo scan; Dawarich stays off. |
| Both sources | Visits already recorded at the chosen place and in the matching period are reused on confirmation, whatever their source. Separate pending photo suggestions are not merged without review. |
| No trip | Suggestions and confirmation work without a trip. No trip is created. |
| Overlapping trips | No automatic choice. A stay only partly covered by a trip is also assigned manually. |
| Flights/hotels/rail etc. off | Not a prerequisite for stay detection; no bookings or nights are derived from it. |
| Places hidden | Automatic and manual scans pause before fetching. Consent and existing suggestions are kept; existing data and a deliberate manual review stay reachable through the API, as with the Places API. Showing Places again resumes the automation already consented to. |
| Connection removed / never stored | No new scans; a clear explanation. Existing suggestions stay reviewable. Shared server credentials do not replace the user's own connection. |
| Consent withdrawn | No new suggestions, not even from a request still in flight. Switching it on again discards any old reservation. |
| No / few / old points | No invented visit. The newest point delivered and the age of the data are shown separately from the successful technical fetch. |
| Capped answer / outage | Partial/failed stays visible; earlier evidence and data states are not deleted. |
| Several places within 100 m | No automatic choice of place; names and coordinates need review. |

## Implementation and acceptance criteria

- One server-side scan precondition for manual scans and the scheduler, checked
  again after the fetch and atomically before writing.
- A separate pause reason and the next run in the existing status answer, shown
  in the profile time zone. No claim of a nightly run: the scheduler runs at
  00:15/06:15/12:15/18:15 UTC.
- Never present a stale scan result as current data. Show different notices for
  no points, data older than 24 hours, and a disabled Places area.
- No automatic trip assignment when only part of the stay falls within the
  trip's local calendar days. Mark ambiguity explicitly.
- Robust position averaging across the date line, and invalid speeds never
  count as stationary evidence.
- Regression tests for partial use, privacy/consent changes, limits and
  ambiguity, reuse of existing visits, and the UI.

## Deliberate limits

No automatic adoption or later change of accepted evidence. No assumption that
a stay at a hotel proves a night there. Unknown coordinates are never named as a
specific restaurant or sight that was visited. Different sources keep their own
raw evidence; one confirmed shared visit can be referenced by several
suggestions. A seven-day window is not a complete historical import.

## Validation

- 24 Dawarich integration checks passed against a new local PostgreSQL test
  database with synthetic users and positions only.
- 30 additional backend checks passed: detection limits, UTC schedules, the
  scheduler and the existing adoption of Immich visits.
- 28 frontend checks passed, including the shared inbox.
- Backend typecheck passed; because of externally linked local dependencies it
  ran as `tsc --noEmit --preserveSymlinks`, without changing production
  TypeScript code for this environment effect.
- Frontend typecheck with `tsc --noEmit` passed.
- Test typecheck: 1,191 backend test files, no errors.
- Lint of the changed production files and frontend tests, and the file-size
  check, passed.
- The existing backend integration tests still need the established Jest flag
  `--forceExit` because of open handles. Serialisation conflicts are triggered
  on purpose in the parallel-acceptance test and handled successfully.
- No database schema change and no new migration needed. No deployment, no
  restart and no change to Prod settings.
