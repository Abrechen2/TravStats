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

The live example is in the owner's own account. `Hotel Sport` was imported on
2026-08-14 carrying a Google Place ID for **Bucharest** — one house, zero stays.
The real hotel is Grajska cesta 2, Otočec, **Slovenia**. Under this rule that one
bad row adds Romania to a passport, from a mistake in a third party's database.

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

Effect on the owner's account, with undated houses counted: transit ≈ 32 ·
stay **40** · overnight ≈ 36. (Without the 2026-09-02 decision the middle figure
would be 35 — the difference is five countries whose only evidence is a house
somebody entered without a date.)

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

**Achievements already granted.** 103 badges in the owner's account are unlocked
with a progress value **below their own requirement** — `COUNTRIES_100` stands at
86, and it unlocked on 2026-04-12 while `COUNTRIES_50` unlocked on 2026-08-15.
The harder badge came four months before the easier one. The mechanism is that
nothing ever re-locks an achievement, so a past miscount is permanent. Fixing the
count does not repair them, and whether a badge may be revoked is a separate
product decision. Filed separately.

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
3. **Retroactive achievements** — may a badge be revoked when the count falls?
   Three options: never revoke (list stays untrue) · revoke (an earned thing is
   taken away) · keep the badge, tell the truth in the progress bar.
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
5. **Provenance in the UI** (3.4): each country row names the records that proved
   it and links to them.
6. **Plausibility flags and the inbox** (3.5): the checks, the flag model, the
   second section on the pending-updates page, renamed to Posteingang.
7. The setting, with the instance default.
8. **Dawarich track evidence** (8): boundaries, the sweep, country-days, the
   airport-proximity rule that keeps a connection a connection.
9. Changelog and the one-time notice.

Steps 2–4 are bug fixes and can ship without the setting. Steps 5 and 6 are what
make the new numbers *checkable*, which matters more than the numbers moving —
every fault found so far was found by looking at evidence, never at a total.
Step 8 is a new capability rather than a correction, and depends on 1–4 existing.
