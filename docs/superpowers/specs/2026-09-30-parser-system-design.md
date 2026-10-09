# The parser system — correctness first, then one path for every template

Status: design, 2026-09-30. Owner direction for this document: **"both, correctness
first"** — no document read wrong, the large gaps in the owner's corpus closed, and
then a single way for templates of every domain to reach every instance without a
release, contributed by users and by AIs and checked by machine before a human looks.

This builds on `docs/superpowers/plans/2026-09-17-parser-templates-all-domains.md`
(phases 1, 4 and the lodging half of 6 are done; 2, 3 and 5 are not) and on the
corpus survey of 2026-09-30. It does not repeat that plan's reasoning; it names where
this design departs from it.

An overview page for the owner exists as an artifact ("TravStats Parser-Plan").

## 1. Where we start, measured

`scripts/parser-corpus.ts --regex-only` over the owner's corpus (gitignored,
`test-samples/`), 2026-09-30. "Wrong" means a reader produced a plausible result that
is false; that is counted separately from "nothing", because a wrong proposal is
accepted by habit and a missing one is not.

| domain | mails | right | wrong | nothing | readers carrying it |
|---|---|---|---|---|---|
| lodging | 108 | 106 | 2 | 0 | booking.com 98, koa 6, travelclick 2, hilton 1, check24 1 |
| lodging, ALL Accor | 2 | 0 → **2** on `feat/accor-lodging-template` | 0 | 2 → 0 | new `accor` |
| flight | 31 | 25 | 6 | 0 | LH-old 19, LH 8, generic regex 4 |
| cruise | 4 | 4 | 0 | 0 | TUI reader |
| rail | 1 | 1 | 0 | 0 | `db-confirmation` |
| round trips (Berge & Meer) | 17 | 0 | 12 | 5 | generic flight regex, wrongly |

The six wrong flights: three Emirates and one Egyptair (Amadeus e-ticket) read by the
generic regex, two Lufthansa connections collapsed into one direct flight. The two
wrong stays: Booking.com's location line with a Czech postcode containing a space
("767 01" → city "767") and a UAE plus-code ("F869C3J" → city "F869C3J").

Separately, a production defect of the same family, 2026-09-30: an ALL Accor booking
for *Novotel Basel City* was imported as a stay at *Hotel Krafft Basel*, because the
lodging matcher treated the shared word "Basel" as identity (§3.1.2).

## 2. Principles

1. **Abstaining is a result; a wrong result is a defect.** Every reader, template and
   matcher either produces something it can defend or declines with a reason. A
   corpus run counts *wrong* as a failure, not as coverage.
2. **A template is data, validated by one validator.** The app, the workshop export,
   the template repository's CI and the loader all call the same validation code, so
   "valid" means one thing.
3. **Nothing becomes active on JSON validity alone.** A template's own test cases run
   in the instance before it is used; a failing template stays inactive and the
   previous version keeps working.
4. **Every step ends in a corpus number.** A package is done when its figure in §8
   is reached, not when its code compiles.
5. **The repo is public.** No real mail, name, booking number or address enters it —
   test cases are synthetic, and CI looks for the obvious leaks.

## 3. Package 1 — correctness of what already reads

Target: **0 wrong** in the corpus; everything else unchanged.

### 3.1.1 ALL Accor template — built

`lodging:accor` on `feat/accor-lodging-template` (`92c00b8ca`): hotel, reservation
number, both dates, total including fees, currency, adults, first room's category,
street/postcode/city/country, chain Accor. Two new engine transforms, both
serialisable: `numericDate` ("01.10.2026", calendar round trip) and `titleCase`
(only for an all-capitals value). 2/2 on the real mails.

### 3.1.2 The lodging matcher stops treating a place name as identity

`namesCouldBeOneHouse` (`services/lodging/nameSimilarity.ts`) accepts, in the same
city, **one** shared "significant" token. "Basel" was that token. Change:

- Before counting, remove from the shared tokens (a) the tokens of either record's
  city, (b) a fixed list of location decor — `city`, `centre`, `center`, `centrum`,
  `zentrum`, `mitte`, `downtown`, `central`, `airport`, `flughafen`, `station`,
  `bahnhof`, `hbf` — and (c) brand tokens.
- **Brand tokens** (`novotel`, `ibis`, `mercure`, `pullman`, `hilton`, `marriott`, …)
  do not identify a house on their own: two Novotels in one city are two hotels.
  They come from one exported list next to `chainFromWebsite.ts`'s brand map, so the
  brand vocabulary has one home.
- What is left must still meet today's thresholds (≥ 1 same city, ≥ 2 unknown city).
  A brand-only overlap may still match through the existing coordinate proximity step
  (≤ 75 m same building), never through the name.
- Signature: `namesCouldBeOneHouse(nameA, nameB, sameCity, places?: string[])`, where
  `places` carries the known city names. All three callers pass them:
  `lodgingImportPreview.ts:297`, `proposeMatch.ts:199`, `openData/openStreetMap.ts:96`
  (the OSM enrichment calls with `sameCity: true` and must be re-measured — a looser
  match there attaches the wrong OSM object to a hotel).

Tests, each failing on today's code where it describes today's bug:
"Novotel Basel City" vs "Hotel Krafft Basel", same city → no; "Novotel Basel City" vs
"Novotel Basel SBB" → no; "Hotel Meteora" vs "Hotel Restaurant Meteora" → yes
(forgejo#84 must not regress); "Emirates Palace" vs "Emirates Palace Mandarin
Oriental", unknown city → yes.

### 3.1.3 The generic flight regex must earn its result

The generic fallback read Berge & Meer invoices and Emirates mails into plausible
wrong flights ("WHO→WHO", a date taken from "ERSETZT RECHNUNG VOM", missing
segments). It keeps running, but a leg is only returned when it carries a flight
number and a date, and its route is either complete — two **different** known
airports — or absent. A route-less leg is incomplete rather than wrong: the flight
lookup fills the route later, and the GitHub #291 controls ("LH400 um 07:35") rely on
exactly that. A half route, a same-airport route or a date-less leg declines, and one
such leg declines the whole document (reason `generic_insufficient_evidence`). A
single route-less candidate is left to the existing #291 second-witness gate
(`shared/evidence.ts`). A document the generic reader declines falls through exactly
as an unread one does today. (Amended 2026-09-30 during implementation; the first
draft required a route on every leg and would have reversed the #291 controls.)

### 3.1.4 Lufthansa connections

The two information mails carry the legs only in their `.ics` attachments. Package 1
makes an airline template decline any result with a leg that has no flight number, so
the numberless direct flight is no longer proposed. Reading the legs from the `.ics`
attachments — one segment per `VEVENT` — belongs to package 2, because attachments
reach the parser only there (§4).

### 3.1.5 Booking.com location line

`parseLage` learns postcodes with an inner space (CZ, SK, SE, GR: `\d{3} \d{2}`) and
refuses a token that is not a postcode as a city (a plus-code, a number). Unreadable
city → `null`, never a code. Two corpus mails pin it.

## 4. Package 2 — the large gaps in the corpus

Target: round trips **0 → at least 12 of 17** read right; flights **31 of 31 right or
declined**.

- **Attachments reach the parser.** Today only the rail path looks at a mail's PDF
  attachments. `extractEmailFromFile` already lists them; the parse route passes each
  PDF through `extractTextFromPdf` as its own `document` and merges the proposals,
  deduplicated by booking reference. Without this, every Berge & Meer cover mail
  (no data in its body) stays unread whatever templates exist.
- **Berge & Meer invoice (flight).** A declarative flight template for the flight
  table ("FRA - DOH QR 070 15.11.24 10:35 18:30"): two-digit years, "+1" arrival,
  flight numbers with a space and leading zero, an optional remarks column, a table
  split by a page break. Versions of one booking ("1R", "2E") are merged by booking
  number, the later one wins.
- **Berge & Meer travel documents (lodging).** One document carries 8–12 stays
  ("19.05.26 - 20.05.26 HOTEL …"). This needs the **repeating block** the 2026-09-17
  plan designed for cruise stops (its phase 5): one spec, reused by lodging first,
  cruise itineraries second.
- **Emirates** (`emirates.email`): segments with IATA codes, times, aircraft, cabin,
  seat; dates like "17. Okt. 25"; matched on body markers too, because one sample is
  forwarded and carries a foreign sender.
- **Amadeus "Electronic Ticket Receipt"** (Egyptair and many others): city names only
  ("MUNICH MUNICH INTERNATIONAL"), resolved through the airport catalogue's name
  index; year-less dates take the issue date's year; the EMD blocks that repeat the
  segments are skipped.
- **The corpus tool** gains a `rail` domain, attachment handling identical to the
  route, and expectations that pin route, date and flight number per segment — so
  the three Emirates mails that "pass" today with wrong routes fail until they are
  right. It also stops reporting a cruise ship as empty when the measuring database
  has no ship catalogue: it reports the parsed ship name.

## 5. Package 3 — one template format for every domain

Target: the Accor template arrives through GitHub instead of a release, with every
corpus figure unchanged.

### 5.1 Envelope

As §3 of the 2026-09-17 plan, extended by `rail`:

```ts
type TemplateDomain = "flight" | "lodging" | "cruise" | "rail";

interface TemplateEnvelope {
  id: string;              // "lodging:accor", "flight:LH"
  domain: TemplateDomain;
  version: string;         // "YYYY.MM.DD" or "YYYY.MM.DD.N" — validated, compared numerically
  issuer: { kind: "airline" | "hotel-chain" | "ota" | "cruise-line" | "rail" | "tour-operator";
            name: string; keys: { senderDomains?: string[]; iata?: string } };
  match: { markers: string[]; anchors: string[] };
  extraction: DomainExtractionSpec;   // discriminated on `domain`
  testCases: TemplateTestCase[];      // ≥ 1 positive AND ≥ 1 must-decline
  minAppVersion?: string;             // a template using a newer transform names it
}
```

`LodgingTemplate` (today's shape) is the lodging extraction spec almost unchanged.
`AirlineTemplate` stays readable behind an adapter. A transform an instance does not
know makes the template **inactive with a reason**, never a crash —
`minAppVersion` states it up front.

### 5.2 Repository

`Abrechen2/travstats-airline-templates` is renamed **`travstats-templates`**. GitHub
redirects the old name. The old `templates/index.json` and airline files stay where
they are, so 2.6.x instances keep receiving airline updates. New layout beside them:

```
index.json            { version: 2, templates: [{ id, domain, version, path }] }
flight/  lodging/  cruise/  rail/
templates/            legacy airline v1 files, unchanged paths
CONTRIBUTING.md
.github/workflows/validate.yml
```

### 5.3 Loader

`services/parsers/templates/registry.ts` reads index v2 first and v1 as fallback,
caches by template id, and — new — runs each template's test cases before
activation (principle 3). The source URL becomes an **admin setting** (default: the
official repo; any `https://` raw base). As with Immich there is no egress allowlist:
an admin may point at a private Git host on the LAN. Failures are reported per
template in the existing template-status route, with the reason kinds
`fetch_failed | invalid | tests_failed | needs_newer_app`.

### 5.4 The two hardcoded readers

Booking.com and TUI are registered as engine-backed entries of the same registry
(2026-09-17 plan, phase 3), so a parse result names the template id whichever reader
answered. Their TypeScript stays; they are not rewritten as data.

## 6. Package 4 — sharing

Target: a template moves from one account to another, and from one instance to
another, with no code.

- **Export / import** under "Meine Templates": the file is exactly a
  `TemplateEnvelope`. Import runs the shared validator and the template's own tests;
  a failing file is refused with the failing case named.
- **Instance-wide templates**: `ParserTemplate` gains `scope: "user" | "instance"`
  (`prisma migrate dev`). Only an admin sets `instance`. Order in the chain: user →
  instance → community → built-in, each still behind its tests; a user template never
  shadows a built-in one that reads the same document correctly (2026-09-17 plan §7).
- **The workshop reads numeric dates**: derivation may choose `numericDate`; the
  message "rein numerisch wie 10.03.2026 nein" goes.
- **"Prepare for GitHub"** in the workshop: produces the envelope with the owner's
  own sample REMOVED and a synthetic test case generated from the marked field
  shapes, which the user reviews before saving.

UI copy in DE first, EN mirrored (locale parity test).

## 7. Package 5 — community and AI pull requests

Target: an AI-written pull request is checked by machine before the owner reads it.

- **One validator, two homes.** `backend/scripts/validate-template.ts` in the app
  repo is the validator (the same module the loader uses). The template repo's
  workflow checks out the app repo at `main` and runs it on every changed file:
  schema, version format and increase, regexes compile, **each regex finishes on
  adversarial input within a time budget** (catastrophic backtracking is refused),
  test cases pass, every template has a must-decline case.
- **Leak check** on test-case text: e-mail addresses, phone numbers, IBANs, booking
  references in the shape of the issuer's own, and names from a small list of common
  first names flag the PR. A flag is a failure the contributor fixes, not a warning.
- **`CONTRIBUTING.md`** with a section "Writing a template with an AI": a ready
  prompt that hands the AI the envelope schema, one example per domain, the rule
  that test cases are invented, and the command to validate locally before opening
  the PR.
- **Documentation**: the travstats.de page `docs/parsers/user-templates` is rewritten
  for workshop, sharing and pull requests (it still describes the admin-only
  flight-only recorder). TravStatsWeb ships in lockstep with the release that
  carries the feature.

## 8. How each package is measured

| package | figure | today | done when |
|---|---|---|---|
| 1 | wrong reads, all domains | 8 + the Accor mismatch | 0 |
| 2 | round trips right / flights right-or-declined | 0 of 17 / 25 of 31 | ≥ 12 / 31 |
| 3 | Accor read after deleting it from `builtins.ts` and serving it from a test repo | — | 2 of 2 |
| 4 | template exported on one instance, imported on another, reads the held-out mail | — | yes |
| 5 | a PR with a leaked name and one with a backtracking regex | — | both refused by CI |

Every package also keeps the gates in CLAUDE.md green and adds a test that fails
without its change.

## 9. Order, branches, releases

One branch per package off `main`; merging into `main` is the owner's release
decision, asked separately each time. Package 1 is fix-sized and belongs in the next
release. Packages 2–5 depend on each other in this order: attachments (2) before the
registry needs them; the envelope (3) before sharing (4) can export it; the shared
validator (3) before the repo's CI (5) can call it.

## 10. Decisions this design needs from the owner

Each has a recommendation; nothing in packages 1–2 waits on them.

| # | question | recommendation |
|---|---|---|
| D1 | Rename the template repo to `travstats-templates` with one folder per domain? | Yes (option A of three; per-domain repos and templates-inside-the-app-repo were weighed and rejected) |
| D2 | Flights: template before language model? | **Decided 2026-10-01 (owner): yes, template first.** Already built on main since 2026-09-17 (`bb2a98b8c`): the admin setting `parserOrder` defaults to `template_first` in every domain; this row wrongly said the model was asked first. Prod (2.6.3) predates it and still asks the model first until 2.7 ships. Accor stays a template and is package 3's pilot for delivery through the repo. |
| D3 | Cruise: decline instead of throwing when no reader matches? | Yes, like lodging |
| D4 | Community templates: active as soon as their tests pass, or after an admin click? | After passing tests, with the admin able to disable any single template |
| D5 | May an admin share another user's template instance-wide, or only their own? | Own and imported ones only |

## 11. Not in this design

- A regex language that replaces the TypeScript readers.
- Cruise itineraries in the workshop's first round.
- Templates that become active without passing tests.
- Coverage at any price: declining stays a valid outcome.
- ~~A tour/roadtrip parser domain: round trips map to flights + stays + a trip.~~ **Reversed by the owner on 2026-10-09:** package tours become a template domain that yields a trip proposal (flights + stays + cruise + booking). See `docs/superpowers/plans/2026-10-09-template-engine-v2-packages.md`.
