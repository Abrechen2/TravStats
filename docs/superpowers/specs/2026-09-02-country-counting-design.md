# Counting countries — what proves you were somewhere

**Status:** proposal, 2026-09-02. Open decisions at the end are the owner's.
**Trigger:** the owner looked at his own figures on the RC and said the country
count was too high. Every number below was measured against that account, not
estimated.

---

## 1. The problem is not one bug, it is four

The headline number is wrong in **both directions at once**, which is why it
looked plausible for so long.

### 1.1 Transits count as visits

The passport's rule is *"a country counts if a flight began OR ended there"*.
That is a defensible rule, and it counts changing planes as having been there.
Measured on the owner's account, seven countries have **no overnight stay and a
ground time under five hours**:

| Country | longest time on the ground |
|---|---|
| Denmark | 1.4 h |
| Poland | 1.6 h |
| Belgium | 1.7 h |
| Qatar | 2.2 h |
| Canada | 2.7 h |
| Bahrain | 3.5 h |
| Ethiopia | 4.7 h |

The next country after that gap is France at **25 hours**. The data separates
connections from stays cleanly, without anyone having to pick a number.

### 1.2 Lodging is not evidence at all

`buildPassport(flights, airportCountries, homeIatas, now, portCalls, placeVisits)`
— there is no lodging parameter. A country reached **by car** and slept in for a
week does not appear, while a four-hour port call does.

Three countries in the owner's account exist only this way: **Czechia, Italy,
Slovenia** — completed hotel stays, no flight ever.

Austria proves the point most sharply: 24 houses, 9 stays — and the passport
counts it **only** because of a single 0.9-hour connection. Remove that one
transit and a country with nine stays disappears.

### 1.3 The achievements count country *names*, the passport counts codes

`UserStats.countries` unions flights, cruises and lodging — which is more correct
than the passport. But flights contribute ISO codes (`DE`) while lodging
contributes the free-text `country` column (`Deutschland`, `Germany`). They never
match, so one country is counted several times.

Measured: **33 ISO codes against 56 distinct strings** in the same account.

```
AT → "Austria" | "Österreich"
CH → "Schweiz" | "Switzerland" | "Schweiz/Suisse/Svizzera/Svizra"
DE → "Deutschland" | "Germany"
CZ → "Česko" | "Tschechien"
```

Union with free text: **88**. Union on ISO codes: **40**. This is the exact
failure `Lodging.isoCountryCode` exists to prevent, and `CLAUDE.md` already
states the rule — *"the text field keeps whatever the source wrote, everything
that GROUPS or COUNTS joins on this instead."*

### 1.4 A saved house without a stay — owner's decision, 2026-09-02

**A lodging with no stay counts as one night.** The owner's reasoning: somebody
took the trouble to enter the house, so they were there — they simply no longer
remember when. Refusing to count it would throw away a memory the user
deliberately recorded.

This is a decision, not a derivation, and it has a price worth naming: **data
quality becomes decisive.** A wrongly imported house is now a country.

**The `Hotel Sport` story this section first told was wrong, and the truth is
worse.** It claimed one house had been imported carrying a Google Place ID for
Bucharest while the real hotel is in Otočec, Slovenia — a mis-geocode. Measured
on 2026-09-02 against the account itself, there is no mis-geocode and there
never was. There are **two different hotels**, each internally consistent:

| name | address | country | coordinates | stays |
|---|---|---|---|---|
| `Hotel Sport - Terme Krka` | Grajska Cesta 2, Otočec | SI | 45.838 / 15.235 | **1** |
| `Hotel Sport` | Bulevardul Basarabia 39, București | RO | 44.434 / 26.150 | **0** |

The Bucharest row's address, city, country and coordinates all agree with each
other. That is why the `address_country_mismatch` check never fired on it —
there is no contradiction to find.

**And the reading that they are two unrelated hotels was ALSO wrong.** The owner,
shown the two rows: *"Das war das Sport Hotel in Slowenien."* The Bucharest row
is not a hotel he saved. It is his Slovenian stay, matched on the NAME to a
different hotel that happens to share it, with that hotel's address, city,
country and coordinates written in wholesale.

That is the finding worth keeping, and it is uncomfortable for this feature:

> **Internal consistency does not mean correctness. It means the geocoder was
> confident.**

A wrong-match import produces a perfectly self-consistent row, so
`address_country_mismatch` — which compares a row against itself — can never
catch one. Nor can any check we could add: nothing in the data distinguishes
"the right hotel" from "a hotel with the same name 1,300 km away". Only the
traveller knows. What DID surface it was `undated_country_evidence`, and only
because the wrong row happened to carry no stay: the country stood on nothing
dated, the inbox said so, and the owner recognised it. That is the check earning
its place, and it is a weaker guarantee than section 3.5 implies — a wrong match
that arrives WITH a stay would pass every check we have.

This document has now been wrong twice about this one row: first calling it a
mis-geocode of a correct address, then calling it a second hotel. Both readings
were built from the data alone, and the data supported both. The correction came
from the only source that could give it.

And it is not one stray row. **One import batch on 2026-08-14 brought in 197
lodgings, 150 of them with no stay at all, and marked every one `visited`.** The
four countries this rule adds to the owner's passport — Croatia, Latvia,
Portugal, Romania — rest *entirely* on stayless rows from that batch. Italy,
Slovenia and Czechia also gained houses there but carry dated stays of their
own, so they would count regardless.

This was put to the owner as a reason to narrow the rule — `batch_id` is null
for a hand-entered house, so "entered deliberately" is available in the data and
the four countries would fall away without touching a single row.

**He declined, on 2026-09-02, having been shown the measurement:**

> *"Alle aus dem Import zählen als besucht, nur welche mit status Storniert für
> einen Aufenthalt zählen nicht sonst 1 Nacht"*

So bulk import is NOT a disqualifier. The only thing that stops a house proving
a country is a **cancellation** — the record positively saying the visit did not
happen. Everything else, imported or hand-entered, dated or not, is one night.

That is what the code already does, and it is the shape `lodgingEvidence`
already had; nothing changed as a result of this measurement except this
paragraph. The consequence, accepted knowingly: **Romania stays in the owner's
passport**, proved by a Bucharest hotel he has never stayed in, and the inbox
reports it as resting only on undated evidence.

One reading is deliberately NOT taken from that sentence. "Only cancelled ones
do not count" could be read as promoting a *future booking* to a visit, which
would reverse the owner's earlier and explicit rule that a stay counts only once
its check-out is past — a booking is not a visit. The sentence answered a
question about imports, so the older rule stands and a future booking still
proves nothing.

Two things follow, and they are not optional:

1. **The evidence must stay visible.** An undated house counts, but the country
   row says it was proved by a stay with no date. That is how the Bucharest
   record was found in the first place — by looking at *why* a country was
   listed, not at the total.
2. **`shared/lodgingCounting.ts`'s check-out rule still governs stays that
   exist.** A stay with a check-out in the FUTURE is a booking, not a visit, and
   must not count. The new rule is about the absence of a stay, not about
   overriding a stay that says "not yet".

---

## 2. What the data cannot tell us

**We cannot know whether someone left the airport.** Six hours in Doha with a
trip into the city and six hours airside are identical in the database. Any
duration threshold is a proxy for a fact we do not hold, and the UI should never
pretend otherwise.

The measurement makes this concrete. Countries by threshold, same account:

| rule | countries |
|---|---|
| no threshold (today) | 28 |
| ≥ 3 h | 22 |
| ≥ 6 h | 20 |
| ≥ 12 h | **20** |
| overnight (calendar day changed) | 21 |

**Six hours and twelve hours give the same answer.** Nobody in this account sits
between them. A configurable hour value would offer precision the data does not
have, and invite turning a dial until the number feels right. That is not a
measurement any more.

---

## 3. The design: evidence tiers, not thresholds

The passport already carries `evidence: flight | port | place` per country with a
"strongest wins" rule. Extend that instead of bolting a threshold beside it.

### 3.1 Three tiers, all derived structurally

| Tier | What proves it |
|---|---|
| **`slept`** | a completed lodging stay · **a lodging with no stay at all** (counts as one night — see 1.4) · a flight arrival and departure on **different local calendar days** · a port call spanning a night |
| **`visited`** | arrival and departure the same local day · a recorded place · a same-day port call |
| **`transit`** | a connection and nothing else |

No hours anywhere. "Different calendar day" is in the data; "six hours" is a
guess. The tiers are computed at the departure airport's clock, which is the rule
the rest of this server already follows.

### 3.2 One setting decides what the headline counts

> **A country counts as visited from …** ○ transit ○ **stay** (default) ○ overnight

**The figures this section first carried were impossible and are withdrawn.** It
read "transit ≈ 32 · stay 40 · overnight ≈ 36", which cannot be: the thresholds
are nested, so *lowering* the bar can never yield fewer countries. `transit ≥
stay ≥ overnight` holds by construction. The numbers were assembled from separate
measurements taken before lodging was folded in, and mixing them produced an
ordering the rule forbids.

They are not re-estimated here. The three counts must be **re-measured against
the implementation** — read-only on the owner's account — before any of them is
quoted in a changelog or a UI notice. A number that contradicts its own rule is
worse than no number, and this document exists because a plausible-looking total
went unchecked for months.

What does hold, and was measured directly: five countries in the owner's account
are proved **only** by a house entered without a date, so they exist at every
threshold under the 1.4 decision and at none without it.

**Instance default set by admin, overridable per user.** "Does a connection
count?" is a personal definition, not a property of the server — imposing one
traveller's philosophy on everyone sharing a family instance is the wrong
default. But a fresh account must not have to decide anything, so the admin sets
the starting point.

### 3.3 The list always shows the evidence, whatever the setting

The number is one answer; the list should be honest regardless. Each row carries
its tier, so a reader can see *why* a country is counted — and spot a wrong one,
which is exactly how the Bucharest hotel was found.

### 3.4 Provenance is visible AND reachable — owner's decision, 2026-09-02

> *"immer schauen dass der User sieht wie die Namen herkommen und veränderbar sind"*

Showing the tier is half the job. The other half is that the record behind it
must be **one click away and editable**. A country row states which records
proved it, and each named record links to the thing itself — the house, the
flight, the place. Seeing "Romania · proved by a lodging with no date" and being
unable to get to that lodging turns a diagnosis into a dead end.

This is the difference between a number that is auditable and a number that is
merely annotated. The Bucharest hotel took a database session to find; after
this it should take two clicks.

It also constrains the API: a country row carries record IDs, not just counts.
`kinds: ["lodging"]` says what sort of thing; it does not say *which* thing.

### 3.4b The stats SHOW hours — they still do not decide by them

Owner, 2026-09-02: *"Die Stats zeigen dann auch entsprechend die verschiedenen
Werte, also durchfahren, übernachtet, Transit 1h 3h <10h usw."*

This does not reverse section 2, and the distinction must stay legible to whoever
reads this next: **a duration is shown as evidence; it is never a threshold.**
The tier still comes from structure — did the local day change, does a record
exist. The measured ground time stands beside it so a reader can judge, which is
the same obligation as 3.4.

**Show the measured value, not buckets.** Fixed classes ("1 h / 3 h / <10 h")
would imply a distribution this data does not have. Measured on the owner's
account, the seven connection countries run 1.4 h → 4.7 h and the next country is
France at **25 h**. Nothing lies between. Buckets would leave the middle bins
permanently empty and hide the one thing the numbers actually say, which is that
there IS a gap and it falls exactly where the tiers already cut.

**Most countries have no hour figure at all, and must not be given one.** Czechia,
Italy and Slovenia are proved only by hotels: their ground time is not small, it
is *unknown*. Writing `0 h` there would be a fabrication, and `Abstention is a
result` already governs it — a value that cannot be derived is absent, never
zero. The UI needs three states per country, not two: measured, unknown, and not
applicable.

Per country, then: the tier, the records that proved it (3.4), the ground time
**where it was measured and short enough to believe**, and the number of distinct
days a record **attests**. Days travel further than hours — they exist for a
lodging, a track and a flight pair alike, whereas hours exist only for a flight
pair and a GPS track.

> **This paragraph was wrong when first written, and 3.4b-bis below is the
> correction.** It said "where it was measured", which sounds like a property of
> the clocks and is not: a spell between two flights is measurable whether it is
> four hours or five years, and only one of those is a stay. It also said "days
> present" without saying attested by what. Both readings shipped, and both
> produced the 2200-day home country that UAT found. Read the two together; this
> one alone understates the rule.

### 3.4b-bis Only attested days count — owner's decision, 2026-09-02 (UAT)

Found on the beta server, not in a test. An account's **home country reported
`daysPresent: 2200` and a ground time of 3,136,245 minutes — 5.5 years.** Both
figures were literally correct and both were nonsense.

The cause is a mistake in 3.4b above, and it is worth stating plainly:

> **Ground time does not measure presence. It measures the absence of a recorded
> departure.**

The records held a landing in Munich on 2020-01-26 and the next German departure
on 2025-07-16, with no flights between. The code read that gap as presence. For a
four-hour connection the inference is safe; over five years it is not — the
records attest the arrival day and the departure day and attest *nothing* about
the days between. That is the rule this whole document rests on, broken by the
document itself. And it is not an edge case: the gap-as-presence reading is
guaranteed to be wrong for the one country every user has.

Three consequences, decided by the owner:

1. **A flight ground spell contributes only its ENDPOINT days** — the arrival
   local day and the departure local day, never the range. Not a special case
   for long spells: the rule for all of them, which makes the code simpler. A
   same-day connection contributes one day, an overnight two, the 5.5-year gap
   two.
2. **Lodging, port calls and place visits are untouched.** A stay from the 12th
   to the 15th attests four days, because the record says so. Only the inferred
   gap loses its middle.
3. **Ground time is `measured` only while the spell spans at most one night.**
   The 25-hour stopover stays visible — that contrast is the point of 3.4b. A
   longer spell becomes `unknown`, the state that already means "a flight
   touched this country but no pair of clocks bounds a stay", and whose UI copy
   ("add the missing flight") is the right instruction for a gap caused by
   unlogged flights.

No fourth state, and no dial: the boundary is the night, the same structural cut
the tiers already use. Section 2 refuses thresholds on principle and this keeps
that promise.

### 3.4c A fourth tier: driven through

Owner, 2026-09-02, confirming Estonia and Lithuania were crossed by car. Passing
a border on the road is not changing planes: you are in the country, on the
ground, often for hours. It deserves its own rung rather than being flattened
into either neighbour.

**`slept` › `visited` › `transited` (by road) › `connection` (airside)**

Only the last is excluded by the default threshold. Driving through counts —
that was the entire point of the Baltic question, and folding it into
`connection` would answer it wrongly.

The rung is **not derivable from curated events**: nothing in a flight, a cruise
or a hotel records a border crossing by car. It becomes observable only with the
track evidence of section 8, and the airport-proximity rule there is precisely
what separates the two lower rungs — points spread across a country versus points
sitting at one airport. Until Dawarich is connected, no record can carry this
tier, and the UI must not offer it as a filter that always returns nothing.

The existing `transit` value is renamed `connection` when this lands, because
after the split "transit" is the word a reader will attach to the road case.
Renaming it later, once it is in stored rows and client code, costs far more.

### 3.5 What cannot be believed goes to the inbox — owner's decision, 2026-09-02

> *"Unplausible Sachen markieren und in den Posteingang"*

This settles open decision 4 below, and it settles it **against** refusing the
import. A geocoder that contradicts the rest of a row is not authority enough to
reject a user's data — but it is more than enough to ask. So the record is
written, flagged, and the question is queued where the user already answers
questions about their data.

The checks that produce a flag are the ones where two sources inside ONE record
disagree, never a judgement about whether a trip was plausible:

| Flag | What disagrees | Live example |
|---|---|---|
| geocoded country ≠ country in the address text | Google Place ID vs. the written address | `Hotel Sport`: place ID says Bucharest, address says Otočec, Slovenia |
| a country proved ONLY by undated evidence | the 1.4 decision, applied honestly | five countries in the owner's account |
| coordinates outside the claimed country's bounds | lat/lon vs. `isoCountryCode` | — |
| a stay whose check-out precedes its check-in | the record against itself | — |

A flag never changes a number by itself. It says "this may be wrong, look" —
counting continues under the stated rule until the user decides. Silently
withholding a country because a check was suspicious would reintroduce, from the
other direction, exactly the invisible arithmetic this whole design removes.

**One inbox, two tables.** `PendingFlightUpdate` carries a required `flightId`,
`apiSource` and `expiresAt`: it is flight-shaped by construction, and 858 lines
of service code depend on that shape. Flags get their own model with a generic
subject (`entityType` + `entityId`) and surface as a second section on the same
page. The user sees one inbox; the schema keeps apart two things that genuinely
differ — a field-level diff from an API, and a question about a record.

---

## 4. One rule, one home

`shared/countryEvidence.ts`, alongside `placeCounting.ts`, `lodgingCounting.ts`
and `flightCounting.ts`. Every consumer reads it:

- `GET /stats/passport`
- `GET /stats/countries` and `countriesIso`
- `GET /stats/countries/:code`
- `UserStats.countries` (achievements)
- `GET /stats/wrapped` → `newCountries`
- the hero tile

They disagree **today** — the achievements say 88 where the passport says 32 —
and that is precisely the drift forgejo#42 was written to end. Folding lodging in
without unifying the rule would create a fifth answer.

The module owns three things and nothing else: the tier derivation, the
`isoCountryCode` join (never free text), and the check-out cut for stays.

---

## 5. It changes numbers people have seen

Every user's count moves. That belongs in the changelog as a decision, not as a
silent fix, and the UI should say it once:

> Zählweise geändert — vorher 32 Länder, jetzt 35. [Was zählt?]

A number that changes without explanation reads as data loss.

---

## 6. What this does not solve

**~~Achievements already granted.~~ Measured 2026-09-02, and the stated
mechanism was wrong.** The observation stands: 103 rows in the owner's account
carry an `unlocked_at` date with a progress value **below their own
requirement**, `COUNTRIES_100` at 86 dated 2026-04-12 while `COUNTRIES_50` is
dated 2026-08-15 — the harder badge four months before the easier one.

The explanation "nothing ever re-locks an achievement" is false. Re-locking is
exactly what happens: held-ness is derived as `progress >= requirement` in every
read (`routes/achievements.ts` list, recent and leaderboard) and in
`planAchievementWrites`, which writes the true progress back and logs a
`revoke_achievements` line when it crosses down. `achievements.revocation.test.ts`
has pinned it since the forgejo#39 work, and it fires: a run that dropped a test
account's flights logged eight codes revoked, `COUNTRIES_5` and `COUNTRIES_10`
among them.

What was actually wrong was the column. `unlocked_at` was
`NOT NULL DEFAULT now()`, so the progress-tracking row the engine creates the
moment a measure first moves off zero also carried a date. None of the 103 was
ever held or ever displayed as held; each is a ladder rung being tracked, dated
by its row's birthday. That is the whole of the inverted ordering. Migration
`20260902170000_achievement_unlocked_at_nullable` makes the column nullable
without a default, nulls those rows, and the write path now clears it on a
revocation — so "revoked" is a state the row can express, not only a log line.

Fixing the country count therefore DOES repair the country badges, on the next
run, by the mechanism that was already there.

**Hong Kong is its own ISO code**, and so are several territories a traveller may
consider part of another country. The tiers do not touch this. It should stay
untouched: the alternative is a hand-maintained list of political opinions.

**Where you actually were inside a country** — a transit through Frankfurt on the
way to Rome does not make Germany a holiday. The tiers say what kind of presence
it was and stop there.

---

## 7. Open decisions — the owner's, not the implementer's

1. **Default tier** for the instance. Proposal: `stay`.
2. **Per-user override** — yes or admin-only? Proposal: yes.
3. ~~**Retroactive achievements** — may a badge be revoked when the count
   falls?~~ **Decided 2026-09-02: revoke.** It also turned out to be what the
   code already did — see §6. The implementation work was therefore not to build
   revocation but to make it legible: `unlocked_at` is nullable now, set only
   when a badge is earned and cleared when it is lost, so the row states the
   verdict the read paths were deriving all along.
4. ~~**Wrong imports are now visible in the count.**~~ **Decided 2026-09-02:
   flag, do not refuse.** See 3.5 — the record is written, the contradiction is
   raised in the inbox, and the count follows the stated rule until the user
   answers. A third-party geocoder does not get a veto over the user's own data.
5. **Overnight derived from flights** — is an arrival on the 3rd and a departure
   on the 4th an overnight stay, even with no hotel recorded? Proposal: yes; it
   is the same evidence a hotel gives, from a different source.

---

## 8. The country nobody logged — Dawarich as measured presence

Added 2026-09-02, after the owner confirmed Estonia and Lithuania were **driven
through**. TravStats cannot represent that today: it stores curated *events*
(flights, cruises, houses), and driving across a border is not an event. Latvia
survives only by accident — there is a house there.

Dawarich stores the opposite thing: continuous position. It is therefore the
evidence class this model is missing, and the plumbing already exists —
`services/dawarich/dawarichClient.ts`, read-only, pinned to and **measured
against Dawarich 1.9.2** on the owner's instance, shipping unGated since 2.6. The
July concept ranked "reconcile countries visited" as idea 2 of 4 and never built
it.

### 8.1 Ask for points, not for countries

Dawarich can compute its own country list, but only where its reverse geocoder is
configured — which many self-hosters do not run. Depending on it would ship a
feature that works on the owner's box and silently returns nothing on everyone
else's. TravStats resolves point → country **itself**, against vendored country
boundaries, exactly as it already vendors the land mask and the marnet graph.

Determinism is the point: the same track yields the same countries on every
instance, with no third-party configuration in the answer.

### 8.2 A fifth evidence kind, and one thing GPS does NOT solve

`track` joins `flight | lodging | port | place`. Points in a country spanning a
local-day change are `slept`; within one day, `visited`.

**A GPS point in Doha is still a point in Qatar even if you never left the
terminal.** Dawarich does not distinguish a connection by itself. It becomes
distinguishable by combination: if every point in a country lies near an airport
TravStats already knows you flew through, the tier stays `transit`. The airport
coordinates are on hand.

### 8.3 Two honesties this must carry

- **Not all of Dawarich is measured.** The owner's own history is
  photo-estimated beyond one year. An estimated presence is evidence, but it is
  not GPS, and the row must say which it was. Presenting an inference as a
  measurement is the failure this entire document exists to correct.
- **Coarse boundaries miss small countries.** 1:110m country outlines are fine
  for Estonia and irrelevant for Liechtenstein, Monaco and Vatican City. Either
  ship finer boundaries or state the limit; do not let a microstate silently
  never appear.

### 8.4 Store country-days, not tracks

A full-history sweep is not a request-time operation — the client already reports
`truncated` when a window exceeds `MAX_PAGES × PAGE_SIZE`. A background job
sweeps month by month and stores `(userId, date, countryCode, source)`. After
that the count is a cheap table read and catching up costs one window.

This is also the privacy-preserving shape, and the concept demands it: a movement
trail is reduced to "on this day, in this country". Raw positions never reach the
frontend.

---

## 9. Order of work

1. `shared/countryEvidence.ts` with the tiers, plus tests that pin a transit, an
   overnight, and a lodging-only country.
2. Fold lodging into the passport — the clearest bug. An undated house counts as
   one night (owner's decision); a stay whose check-out is still in the future
   does not.
3. Fix the achievements union to join on `isoCountryCode`. This alone moves the
   owner's figure from 88 to 40.
4. Point every consumer at the module; delete the local re-derivations.
   **This is now overdue and measurable.** `shared/countryEvidence.ts` carries a
   private `toCountryCode`, and `utils/achievementStats.ts` carries its own
   `toCountryCode` / `normalizeCountrySet` / `unionCountries`. Two copies of the
   name→code join exist as of 2026-09-02 — the exact shape `utils/continents.ts`
   was written to end, where two byte-identical copies "carried a 'keep both in
   sync' comment and had already drifted". The achievements side must import the
   shared module, not keep a sibling.

   The extraction was built and backed out once, for a reason worth recording:
   removing those functions drops `achievementStats.ts` below 800, which the
   size ratchet reports as a **stale baseline entry** — a hard failure. A
   baselined file therefore has a *corridor*, not a ceiling, and leaving the
   list requires `check:size -- --update` as a deliberate, coordinated step once
   no agent holds a file. Do that first, then move the code.
5. **Provenance in the UI** (3.4, 3.4b): each country row names the records that
   proved it and links to them, and shows its tier, its distinct days present,
   and its ground time **where one was measured** — blank, never `0 h`, where it
   was not.
6. **Plausibility flags and the inbox** (3.5): the checks, the flag model, the
   second section on the pending-updates page, renamed to Posteingang.
7. The setting, with the instance default.
8. **Dawarich track evidence** (8): boundaries, the sweep, country-days, the
   airport-proximity rule that keeps a connection a connection — and with it the
   `transited` rung of 3.4c, which no other data source can populate. The rename
   `transit` → `connection` belongs to this step and must not be deferred past
   it, since the value is by then in stored rows and client code.
9. Changelog and the one-time notice.

Steps 2–4 are bug fixes and can ship without the setting. Steps 5 and 6 are what
make the new numbers *checkable*, which matters more than the numbers moving —
every fault found so far was found by looking at evidence, never at a total.
Step 8 is a new capability rather than a correction, and depends on 1–4 existing.
