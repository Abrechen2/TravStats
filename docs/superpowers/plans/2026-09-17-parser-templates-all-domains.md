# One template mechanism for all four domains

Owner decision, 2026-09-17: **build both** — open the template workshop to
every domain, and extend the GitHub-synced loader beyond airlines, cruises
included. This document is the plan. Phases 1 and 4 were built the same night — §8 says
what they delivered and what the measurement changed about the rest.

Written with Codex (`gpt-5.5`) as a cold second opinion on the data model and
the order of work. Its structure is kept where it was better than mine; three
of its claims were re-measured here before being adopted, and one of them
turned out to be the most consequential finding in the document (§2.1).

## 1. Where we start, measured

`backend/scripts/parser-corpus.ts --regex-only`, on the owner's own corpus,
with the LLM genuinely out of reach (the flag was ineffective until `7e875757`
— see `feedback_probe_setup_failure_looks_like_a_result`):

| Domain | Files | Read by a template | Read by nothing |
|---|---|---|---|
| flight | 31 | 31 — 29/29 expectations, under a second | 0 |
| lodging | 108 | 97 | 11 |
| cruise | 4 | 4 | 0 |

The same flight corpus through `gemma3:12b`: **19 minutes and three misses.**

Three unrelated mechanisms produce that table, and only one domain has all
three:

| | Built-in | Workshop (DB) | GitHub sync |
|---|---|---|---|
| flight | 9 airline JSONs (`templates/airlines/`) | yes, applied in `parsers/email.ts` | yes, keyed by IATA |
| lodging | 1 × TypeScript (`lodging/bookingComTemplate.ts`) | no | no |
| cruise | 1 × TypeScript (`cruise/tuiCruisesTemplate.ts`) | no | no |
| place/tour | — | no | no |

`ParserTemplate.domain` exists and is dormant: nothing writes a value other
than the `"flight"` default, and `userTemplates/matcher.ts` queries
`{ userId, status: "active" }` with no domain filter at all.

The 11 unread lodging mails, by sender: KOA ×6, Armani Hotel Dubai ×2,
res.hilton.com ×1, Novina Sleep Inn ×1, one with an emoji subject. (A twelfth
was a *changed* Booking.com booking; that one is fixed —
`fix/bookingcom-changed-booking`, forgejo#122.)

## 2. Findings that change the plan

### 2.1 Flight parsing is LLM-first, and that is now measurably the wrong way round

`backend/src/services/parsers/email.ts:163`:

```ts
const ollamaConfigured = !!config.ollamaUrl && config.textFallbacks.includes("ollama");
if (ollamaConfigured) {
  // Try Ollama first (before templates) when explicitly configured
```

Lodging and cruise are the opposite — template first, LLM as the fallback.

The comment says Ollama "takes priority over templates", which was a reasonable
assumption when no one had measured the templates. Today's measurement
contradicts it in both directions at once: on the same 31 mails the template
path is **perfect and instant**, the LLM path is **19 minutes and three misses**.
Every instance with an Ollama configured — which is the recommended setup —
therefore takes the slower, worse path for exactly the mails we read best.

**This is an owner decision, not a refactor**: flipping it changes what every
flight import does. It also has a knock-on: `applyEmailRegexPostProcessing`
runs on the LLM result, and the template path's own post-processing differs.

Proposed: template first for flight too, LLM when the template abstains or
returns nothing — the rule the other two domains already follow. One rule per
domain, documented, and the same order in all four.

### 2.2 Four confidence scales that do not mean the same thing

| Source | Gate / value |
|---|---|
| user workshop template | accepted at `>= 80` (`parsers/email.ts:142`) |
| community airline template | accepted at `>= 30` (`parsers/email.ts:216`) |
| Booking.com reader | returns 95, or 80 with a missing field |
| TUI reader | returns 95, always |

A shared registry must not compare these. Either each domain keeps its own
threshold with a stated meaning, or the numbers get one definition. Until then,
no cross-domain "best confidence wins" logic may be written.

### 2.3 Cruise throws where lodging abstains

`cruiseBookingParser.ts:526` throws when Ollama is unreachable and no template
matched; `lodgingBookingParser.ts` returns `parserUsed: "none"`. Once template
abstention becomes normal (it is the whole point of §4 Phase 4), an instance
without an LLM would get an error for an unknown cruise line and a calm empty
result for an unknown hotel. Same situation, two answers.

## 3. The data model

**One envelope, a per-domain extraction spec.** The reusable part of a template
is not its fields — it is its lifecycle: match the document, optionally repeat
over a block, extract, transform, check minimum evidence, return proposals,
carry tests and provenance.

```ts
type TemplateDomain = "flight" | "lodging" | "cruise" | "place";

interface CommunityTemplate {
  id: string;            // "flight:LH", "lodging:booking.com", "cruise:tui-cruises"
  domain: TemplateDomain;
  version: string;
  issuer: TemplateIssuer;
  match: TemplateMatch;          // from[], subject[], bodyMarkers[]
  extraction: DomainExtractionSpec;   // discriminated on `domain`
  transforms?: Record<string, TransformName[]>;
  testCases: TemplateTestCase[];
}
```

Per-domain field sets live in their own modules
(`services/parsers/templates/domains/{flight,lodging,cruise,place}.ts`), the
envelope in `templates/types.ts`. A fifth domain is then one module, one
adapter, one validator, and its tests — not a rewrite.

**Keys, not IATA.** A hotel cannot be keyed by `iata`. The issuer carries the
identity it actually has:

```ts
issuer: { kind: "hotel-chain", name: "Hilton",
          keys: { senderDomains: ["res.hilton.com", "hilton.com"] } }
```

`AirlineTemplate` is **not deleted**: it becomes legacy flight v1 behind an
adapter (`iata` → `issuer.keys.iata`, `airline` → `issuer.name`, `from`/`subject`
→ `match`, the rest → the flight extraction spec). The registry keeps reading
the old `airlines` index for one migration window, and caches by template id —
`LH.json` and `hilton.json` are not one namespace.

The GitHub index becomes domain-grouped (`{ id, domain, version, path }`), so
the loader learns hotels and ships without a second sync path.

**`ParserTemplate`**: keep the existing `domain` column, add
`@@index([userId, domain, status])` via `prisma migrate dev`, and replace the
flight-shaped `TemplatePatterns` type with a discriminated union. The JSON
columns stay JSON; it is the TypeScript that must stop pretending every
template is a flight template.

## 4. Cruise stops

**Position: declarative templates must carry a repeating stop list.** Leaving
itineraries to the LLM for ever would mean the one domain whose mails are the
most structured is the one we read the least reliably.

Generalise the flight-only `segments` splitter into a domain-neutral
`RepeatingBlockSpec` with `mode: "split" | "matchAll"`, an optional
`startAfter`/`endBefore` fence, and per-field patterns with transforms. TUI's
run-on itinerary is a `matchAll` over date anchors — which is what
`tuiCruisesTemplate.ts` already does in code.

The boundary is explicit: a declarative stop list carries **date, label,
optional times**. It never infers countries, port identities, tender notes or
bundled flights. A stop with `country: null` and no times is a good result;
guessing those is how the three-state stop invariant gets broken.

## 5. The two hardcoded readers

They stay TypeScript. `bookingComTemplate.ts` encodes grammar, not regexes: two
layouts, a label stop-list, German month parsing, address segmentation that
copes with Luxembourg and Singapore postcode placement, currency symbols and
ISO codes, and deliberate abstention. Expressing that in JSON means either
losing correctness or inventing a programming language in JSON. Bad trade,
and Codex and I agree on it.

What moves into data is their **matching metadata and identity**, so they are
visible in the same registry as everything else:

```json
{ "domain": "lodging", "id": "lodging:booking.com", "engine": "bookingCom.v1" }
```

The engine name binds to a named TypeScript capability. Later, only the parts
that are genuinely declarative migrate; address parsing and money
normalisation stay shared code that templates call, never copy.

## 6. Order of work

Each phase ends in a number from §1. Phases 1–5 are backend-only and safe
before the `dev/design-system` merge; Phase 6 needs the redesigned `/parser`
page and waits for it.

| Phase | What | Expected corpus result |
|---|---|---|
| **1. Safety** | `findMatchingTemplate` requires a domain; callers pass `"flight"`; `@@index([userId, domain, status])`; a test proving a lodging template is never tried on a flight mail | unchanged — this prevents a future false match |
| **2. Registry v2** | domain-aware envelope; registry loads both the old airline index and the new `templates[]`; status entries gain `id`, `domain`, `issuer` | 31/31 · 97/108 · 4/4, unchanged |
| **3. Wrap the readers** | Booking.com and TUI registered as `engine`-backed templates; parse results report the registry id | unchanged, but now visible through one path |
| **4. Declarative lodging** | lodging field specs; first non-Booking.com templates from the unread classes (Hilton, Armani, Novina, KOA) with strict minimum evidence (name + date range required, price and city nullable) | lodging **97 → 101–104 of 108**. Not 108: some senders are one-offs, and predictable abstention beats a heroic regex |
| **5. Declarative cruise stops** | `RepeatingBlockSpec`; TUI itinerary ported to data only where behaviour is preserved; `tuiCruises.v1` code stays until parity is proven | cruise 4/4, no stop-count regression |
| **6. Workshop for all domains** | domain on training data, per-domain annotation labels and derivation, preview before activation, `ParserTemplate.domain` actually written | a user-derived lodging template reads a held-out lodging mail, and is invisible to flight parsing |

Separate from the phases, because they are owner decisions rather than work:
**§2.1** (flight template-first) and **§2.3** (cruise abstains instead of
throwing).

## 7. Traps

- **The known one**: no domain filter in the matcher. The day a lodging
  template exists, it is tried against flight mails. Phase 1 exists for this.
- **A matching template is not an extracting template.** Minimum evidence per
  domain has to be checked before candidates are returned, or a template that
  matches and extracts nothing looks like a parse.
- **A template that extracts garbage is worse than none.** The result is only a
  proposal a human confirms — but a plausible wrong value gets accepted by
  habit, which is exactly how the airline-logo plate shipped invisible.
- **Community templates must not activate on JSON validity alone.** Their
  `testCases` have to pass locally first, and a test suite of one happy path is
  not a gate: negative cases and must-abstain cases are the point.
- **Per-user before community, but only when proven.** A bad personal template
  must not shadow a good built-in one.
- **`bodyMarkers` are case-sensitive**, and subject matching is a substring
  test. "Your reservation" is a subject a dozen chains share.
- **Version strings are compared as strings.** Fix and validate the format
  before the loader orders anything by it.
- **Four confidence scales** (§2.2). No cross-domain comparison until they mean
  one thing.

## 8. What the first night delivered (2026-09-17, `fix/bookingcom-changed-booking`)

Phases 1 and 4 are done; 2, 3 and 5 are not started, for the reasons in §6.

| | before | after |
|---|---|---|
| lodging, template-read | 97 of 108 | **108 of 108** |
| lodging, read by nothing | 11 | **0** |
| pinned expectations | 96 of 96 | 96 of 96 |

**Phase 1** made `findMatchingTemplate` require a domain and gave it the index
the query asks for. **Phase 4** added three declarative readers (KOA, Hilton,
travelclick) and then a fourth (CHECK24) — but two of the nine mails that came
in were not coverage at all, they were defects in the oldest reader:

- `parseGermanDate` demanded the ordinal dot, so "26 November 2022" returned
  null and the whole confirmation was declined.
- `parseLage` read a four-digit US HOUSE NUMBER as a European postcode and
  imported the city as "Regent Boulevard". Name-plus-city is what the import
  dedupes on, so that would have split one hotel into two.

**Who actually carries the load**, now that the corpus can say (the tool
reported only "template"/"regex" before):

| domain | readers |
|---|---|
| flight, 31 mails | `LH-old` 19, `LH` 8, generic regex 4 |
| lodging, 108 mails | `booking.com` 98, `koa` 6, `travelclick` 2, `hilton` 1, `check24` 1 |
| cruise, 4 mails | the TUI reader, 4 |

Two things that changes about the plan:

1. The airline templates are **load-bearing** — 27 of 31 flight mails — which
   is the premise phases 2 and 3 rest on. Good.
2. The flight corpus is **all Lufthansa**. Seven of the nine built-in airline
   templates (EW, FR, LX, OS, SN, U2, W6) are unmeasured, and a registry
   change that broke one of them would pass every check we have.

A cold review (Codex) of the night's work found five defects, all fixed with
tests: a price restated without its unit was written against the STORED
currency; the commit took the client's word for WHICH booking a row updates;
a date-only change left the FX snapshot on the old rate day; a stay over New
Year dated without years ended before it began; and under `llm_first` a model
that THREW lost a document its template could read.

## 9. What we deliberately do not build

- One universal regex language that replaces the two hardcoded readers.
  Re-creating TypeScript badly, in JSON.
- Cruise-itinerary authoring in the workshop's first release. Header fields
  first; a repeated-row editor is its own piece of UI.
- Self-updating community templates that reach `active` without passing tests.
- 108 of 108 lodging. The goal is high coverage **plus predictable
  abstention**, not a regex for every mail anyone ever sent.
