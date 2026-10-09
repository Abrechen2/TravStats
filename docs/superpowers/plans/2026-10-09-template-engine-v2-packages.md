# Template engine v2: every issuer in the template repo, package tours included

Branch: `dev/template-engine-v2` (long-running — merge `main` in after every release, never rebase).
Builds on `docs/superpowers/specs/2026-09-30-parser-system-design.md` (packages 3 and 5) and
`docs/superpowers/plans/2026-09-17-parser-templates-all-domains.md` (phases 2, 3, 5).

## Owner rulings (2026-10-09)

1. **Only generic readers are compiled into the server.** Generic = standards and the model:
   IATA BCBP boarding-pass barcodes, QR/PDF417 decoding, structured mail data (schema.org
   JSON-LD, iCal), the LLM parser, and the template engine itself. Everything that names an
   issuer — airlines, Booking.com, TUI, Accor, Hilton, HRS, DB, AIDA, Berge & Meer — lives in
   `Abrechen2/travstats-templates`, so a layout fix reaches every instance without a release.
2. **Package tours become a template domain.** This reverses spec §11 ("a tour/roadtrip parser
   domain … out of scope"). One document yields a *trip proposal*: trip, flights, stays, an
   optional cruise, one booking with the total price, and the document itself.
3. **Country relevance orders, never filters.** Every template carries `markets` (ISO 3166-1
   alpha-2). All templates are loaded; those matching the user's home country are tried first.
   A booking with a foreign operator is still recognised. New user setting: home country.
4. **Order of work:** engine → package tours (Berge & Meer usable) → move every built-in issuer
   reader into the repo → countries.

## Why

Measured on the owner's own Berge & Meer documents (10 PDFs, 7 trips, 2022–2026): each one
carries 4–6 flights with local times, 6–14 hotel nights with names and addresses (travel
documents) or the package price, excursions and discounts (invoice). Entering one trip by hand
took ~15 API calls and two gaps the API could not close (#355, #356). A user-uploaded PDF
should produce the same result as a reviewable proposal.

## Phases

### P1 — v2 envelope, validator, loader (server)
- `services/parsers/templates/v2/`: the envelope type from spec §6 (`id`, `domain`, `version`,
  `issuer`, `markets`, `match`, `extraction`, `testCases`, `minAppVersion`) and one Zod
  validator shared by the loader and the repo CI.
- Loader: v2 `index.json` first, v1 `templates/index.json` fallback; disk cache; 24 h refresh;
  each template's `testCases` run before it is activated; reasons
  `fetch_failed | invalid | tests_failed | needs_newer_app`, surfaced in `/template-status`.
- Source URL becomes an admin setting (default: the public repo).
- Guard: a template whose test case fails is never active; a test pins that.

**P1 as built (2026-10-09).** `services/parsers/templates/v2/`: `envelope.ts` (the one Zod
schema + index schema), `version.ts` (numeric compare for semver and `YYYY.MM.DD[.N]`),
`runners.ts` (domain → test runner; P1 registers the matcher for all five domains — it decides
match/decline from `markers`/`anchors` and ignores `expected`), `loader.ts`
(`V2TemplateStore`), `cache.ts` (`.template-cache/v2/<domain>__<slug>.json`), `status.ts`.
- The v1 airline sync still runs on every sync, after v2: airlines have no v2 templates
  until P4, and with the v2 index absent the v1 requests are byte-for-byte the old ones.
- A newer version that fails keeps the older active one (status carries a `detail`); a
  template the index stops naming is deactivated and uncached; a domain with no runner is
  `invalid`.
- `/template-status` gains a `v2` field (`index`, `templates[]` with `state`, `reason`,
  `detail`); the v1 fields are unchanged.
- **Source URL is still an environment variable, not yet an admin setting:**
  `TEMPLATE_REPO_BASE_URL` (repository raw root, https only, default the public repo).
  Moving it into `admin_settings` with a settings UI field is the open remainder of P1.
- The repository's `rail/db.json` draft does not validate yet: its test case has no
  `expect` and no must-decline case. `testCases[].input` accepts the draft's
  `{ subject, text, from? }` object as well as a plain string.

### P2 — generic extraction constructs
- `repeat` block for every domain (`mode: split | matchAll`, `startAfter`, `endBefore`,
  per-field rules) — generalises flight `segments` and the rail draft's `legs.repeat`.
- Transforms the corpus needs: two-digit-year dates, `+1` day rollover, `QR 070` flight numbers,
  city name → IATA via the airport catalogue, money with German separators.

### P3 — package domain + trip proposal
- `extraction` for `domain: "package"`: `booking` fields (reference, issued on, travellers,
  total, currency, line items), repeat blocks `flights[]`, `stays[]`, optional `cruise`.
- `parseDocument` gains a `package` body; routes return it as a **trip proposal**.
- Preview/commit service: match an existing trip (by booking reference, then date overlap),
  existing flights (number + day) and stays (lodging name + check-in); propose create vs.
  attach; commit through the existing services. Fixes #355 on the way (flight create keeps
  `tripId`) and the booking gaps noted on #356 (set a booking's trip, file flights on it).
- Two documents of one booking (invoice + travel documents, `/1`, `/2E`, `1R`) merge by
  booking reference: the later one completes the proposal, never duplicates it.
- Frontend: a proposal screen (DE/EN) — what is new, what attaches, what conflicts.
- First template: `package/berge-meer-invoice.json` + `package/berge-meer-documents.json`
  in the repo, with **invented** test cases (CONTRIBUTING rule) shaped like the real layout.
  The TypeScript reader `services/trip/tripDocumentParser.ts` is the reference and is deleted
  once the templates pass the same measurement (`scripts/measureTripSamples.ts`).

### P4 — move the issuer readers out
- Airlines v1 → v2 `flight/`; lodging built-ins (koa, hilton, travelclick, check24, accor, hrs)
  → `lodging/` (exports exist, need test cases); rail DB → `rail/`; cruise AIDA/TUI → `cruise/`;
  Booking.com and TUI code readers → templates (engine gaps found here go back to P2).
- Each move: template passes the same fixtures the code reader passed, then the code is deleted.

### P5 — markets
- `markets` on every template; user setting "Heimatland / Home country" (DE/EN);
  engine orders candidates home-market first. No filtering.

## Out of scope here
- Sharing user templates (spec package 4).
- Attachment routing for flight/lodging mails (spec package 2) — needed for mails, not for
  uploaded PDFs; scheduled after P3.
