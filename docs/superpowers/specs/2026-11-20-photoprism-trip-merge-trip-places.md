# Owner ideas 2026-11-20 — places in trips, PhotoPrism, merging a trip across two servers

**Status:** concept, nothing built. Open questions for the owner are in §5;
every "proposal" below is a recommendation until he answers.
**Order proposed:** A (places in trips) → B (PhotoPrism) → C (merge). A has no
open decision and is the base C needs; C is the largest and depends on answers.

---

## A. Places in a trip: stored, but hardly visible

### A.1 What exists (measured on forgejo/main, 2.8.0-rc.36)

- A visit links a place to a trip through `PlaceVisit.tripId`. The trip detail
  page loads them with `useTripPlaceVisits` (`listPlaces({ tripId })`).
- **Timeline:** `PlaceVisitCard` (`components/Trips/TimelineEventCards.tsx`)
  shows the category icon, the name, a subtitle, the visit notes and a
  precision-aware date/time (`tripTimeline.ts`). What it lacks is a word for
  its kind — it reads like any other card in the POI hue — and a link to the
  place.
- **Trip map:** `TripMap` / `TripMapWithTours` draw flights, cruise, rail, bus,
  ferry, stays, stops and tours. They do not draw place visits.
- **Head and insights** (`TripHead`, `TripInsightsBar`, `TripCard`): no count
  and no list of places. Only the trip's `countries` include place countries
  (companion#85 item 3).
- **Failure path:** `useTripPlaceVisits` logs a failed load and shows an empty
  list. The trip then looks as if it has no places. That breaks the owner rule
  "every error is visible" (2026-11-18).
- **Share link view:** it leaves places out on purpose. That stays as it is.

### A.2 Concept

1. **Timeline card.**
   - The card names its kind ("Ort besucht" / "Place visited") next to the category.
   - It links to the place (`/places/:id`).
   - A place that is still only planned for this trip is marked as planned. The counting rule in `shared/placeCounting.ts` decides which.
2. **Trip map.**
   - A place-visit layer: a POI-coloured dot with the category icon, drawn in the same style as the dashboard's place layer.
   - A click opens the place card through the trip map's card host (`TripMapCardHost`).
   - The places are included in the map bounds, and the map gets a legend row "Orte".
   - The layer is hidden when the `poi` domain is off (`usePlacesVisible`).
   - Each visit is placed at its place's coordinates. `Place.lat/lon` are required, so every place can be drawn.
3. **Head / insights.** "N Orte" next to the other counts. N counts distinct places that the counting rule (`shared/placeCounting.ts`) counts as visited; planned-only visits are not counted. See §5 Q7. It links to the timeline filtered to places (or scrolls there).
4. **Trip list card.** The same count, only when it is > 0.
5. **Failure.** A failed load shows a line on the trip ("Orte konnten nicht geladen werden · Erneut versuchen") and a `logger.warn`, never an empty list.
6. **Companion.**
   - The existing `GET /places?tripId=` already carries everything above, so the server contract is unchanged.
   - The app can show the same blocks later; this is noted in the hand-over, not built here.

Tests:
- one per surface, written red first;
- each test drives the failure path and asserts what the user sees (CLAUDE.md, "four defect classes");
- a browser look at the trip map, because a layer that draws nothing passes every unit test.

---

## B. PhotoPrism as a second photo source, like Immich

### B.1 What exists

Immich today:
- `services/immich/**` and `routes/immich/**`;
- table `TripImmichAlbum` (mode `link` | `import`) and `ImmichImportJob`;
- connection fields `immichBaseUrl` / `immichApiKey` in user settings, plus the admin-global connection and an ENV connection;
- a catalogue entry `immich`, an account-type service that is off by default;
- the resolver `services/immich/immichResolver.ts`; PhotoPrism uses the same tiers, whatever that resolver allows today;
- the egress rule from forgejo#411: an ordinary account reaches public addresses only; an admin's own connection may reach the LAN;
- an asset proxy that checks ownership and membership, with ETag caching;
- the fixed failure vocabulary `notConfigured|unreachable|auth|notFound|protocol|invalidUrl`.

### B.2 PhotoPrism facts the design rests on (to verify against a real instance in phase B0)

- REST API under `/api/v1`. Auth is an app password / access token sent as `Authorization: Bearer`. User name and password through `POST /api/v1/session` also work, but are not used: we do not want to store an account password.
- Albums: `GET /api/v1/albums?type=album&count=…`. Photos of an album: `GET /api/v1/photos?s=<albumUID>&count=…&offset=…`. A photo carries `TakenAt`, `Lat`/`Lng` and its file `Hash`.
- Thumbnails: `/api/v1/t/<hash>/<previewToken>/<size>`. Originals: `/api/v1/dl/<hash>?t=<downloadToken>`. Both tokens come from the session/config response, and they rotate.

### B.3 Concept

1. **One photo-source layer, two providers.**
   - Today's Immich code becomes the first implementation of a small interface:
     - `listAlbums`
     - `listAlbumAssets(albumId, page)`
     - `streamThumbnail(assetId, size)`
     - `streamOriginal(assetId)`
     - `test()`
   - PhotoPrism is the second implementation.
   - The routes, the gallery, the cover and the import job talk to the interface only.
2. **Data model, additive.**
   - `TripImmichAlbum` gains `provider` (`immich` | `photoprism`, default `immich`). The import job and `TripPhoto.immichAssetId` get the same.
   - The tables keep their names. A rename is a change Prisma cannot see and would need a hand-written migration plus a replay test. The new column is an ordinary `migrate dev` migration, with `check:drift` staying green.
   - Every key that names an Immich id gets the provider too: the unique indexes `(tripId, immichAssetId)` and `(tripId, immichAlbumId)`, the asset cache key (`immichAssetCache.ts`) and the trip-merge deduplication (`services/trip/mergeTripRelations.ts`). Otherwise an id could collide across providers.
3. **Connection.**
   - New user fields `photoprismBaseUrl` / `photoprismToken`, stored encrypted like the Immich key.
   - The same resolution tiers as the Immich resolver.
   - The same egress rule (forgejo#411) and its tests: an ordinary account reaches public addresses only, DNS is pinned, redirects are not followed.
   - A catalogue entry `photoprism` of the account kind, off until switched on.
4. **Tokens.** Preview and download tokens are fetched by the server, cached for a short time and refreshed after a 401. They never reach the browser: the proxy is the only path, as with Immich.
5. **Failures.** The same fixed kinds as Immich, mapped from PhotoPrism's answers. A PhotoPrism instance whose version is too old answers `protocol`.
6. **UI.**
   - "Verbundene Dienste" gets a PhotoPrism card.
   - The trip's album picker gets a source switch when both sources are connected. With only one connected, there is no switch.
   - Gallery groups are labelled with their source.
7. **Phases.**
   - B0: check §B.2 against a real PhotoPrism (a test container on lisbeth).
   - B1: interface plus the Immich refactor, with no change in behaviour (the existing suite is the guard).
   - B2: PhotoPrism link mode.
   - B3: import mode.
   - B4: the photo dots on the trip map, if Immich has them by then.

---

## C. Merging the same trip from two servers ("Reise zusammenlegen")

**Case:** two travellers each entered the same holiday on their own server, independently. The two versions differ: one has flights the other lacks, the times differ, and one has places the other never found. Both versions should become one agreed state, held on both servers.

### C.1 What exists

- Federated trip sharing (spec `2026-10-20-federated-trip-sharing-design.md`):
  - admitted peers;
  - per-user consent;
  - linked copies (decision 1);
  - facts sync, private fields never travel (decisions 2 and O1);
  - changes are applied and announced with undo, deletes never propagate (decision 3);
  - hub topology;
  - the per-type registry `services/sharing/shareTypes.ts`.
- Sharing so far always STARTS from one trip and copies it into the other account. Two trips that already exist cannot be joined.
- **Place visits are not a shared type:** `poi: { notShared: "A place visit is the visitor's own; owner decision 2 keeps it private." }`.
- "Evidence" exists per entry: documents (`documents.ts`), provenance (`writtenVia`, the evidence keys of location findings) and photos.
- There is no "AI audit" feature yet. The AI providers (Ollama, OpenAI-compatible) are used only by the parsers.
- Merging two trips of ONE account exists: `mergeTrips` (`services/tripCleanupService.ts`) moves relations through `services/trip/mergeTripRelations.ts`. The apply step below reuses it on each server.
- Propagation between servers is asynchronous and field-preconditioned (federated spec F6–F7); it is not a commit across two servers. An `entry-removed` message only notifies; it deletes nothing.

### C.2 Concept — five steps

1. **Propose.**
   - On trip A: "Mit der Reise eines Mitreisenden zusammenlegen". Pick a co-traveller with an accepted federation consent.
   - Their server offers its own trips that overlap A's dates (sorted by overlap, then by countries in common).
   - They choose B in their inbox and accept. Without that acceptance nothing is compared.
2. **Pair.** Both servers exchange the **fact** lists of the trip, using the same per-type field lists as sharing: private fields stay home.
   - Entries are paired by a deterministic key per type:
     - flight: date + flight number, or date + route;
     - stay: lodging + check-in/check-out;
     - rail/bus/ferry: date + from/to;
     - cruise: ship + embarkation day;
     - place visit: the same place (by catalogue id, or by name + less than 150 m apart) + day.
   - Result per entry: **same**, **only in A**, **only in B** or **conflict** (field by field).
3. **Evidence.** For each entry, each side sends an evidence summary, not the evidence itself:
   - document type and date ("Buchungsbestätigung, PDF");
   - how it was entered (`writtenVia`: import, mail, app, by hand, location finding);
   - photos with EXIF time/position in the period (count only);
   - a GPS track that covers it.
4. **AI audit.**
   - Rules come first. Evidence ranks document > track > photo EXIF > location finding > entered by hand. An entry that is "only in A/B" and has evidence is proposed as "add".
   - The AI audit judges only what the rules leave open: real conflicts, likely duplicates with different keys, entries without evidence. It uses the configured AI provider, local Ollama by default.
   - It gets facts plus evidence summaries, never private fields, and gives per item a proposal (A | B | both | neither), a reason in one sentence and a confidence.
   - **It proposes, it never decides.** With no AI provider configured, step 4 is rules only, and the screen says so.
5. **Decide and apply.**
   - One screen with one row per difference: both versions side by side, their evidence, the proposal, and the buttons "A stimmt" / "B stimmt" / "beide behalten" / "keins".
   - Either traveller may decide a row. The other sees the decision and confirms it. Only when every row is confirmed by both is the result applied.
   - **A merge is a durable object of its own:** a merge id, the frozen fact lists of both sides (a revision per side), and per row the decision with both confirmations, bound to that revision. If either trip changes after the comparison, the affected rows reopen instead of being applied to data nobody looked at.
   - **Applying** is done by each server on its own trip from the agreed result: add, change, remove. The result travels as one new signed protocol operation `merge-apply` (merge id, revision, the decided rows), not as a series of ordinary edits. Each server reports `applied` / `failed <reason>` per row. A partial application stays visible on the merge ("3 von 41 Einträgen nicht übernommen · erneut versuchen") and is retried, never hidden. A peer whose software does not know `merge-apply` is refused at the proposal (capability check), not halfway through.
   - **Removing** an entry crosses servers only through `merge-apply`, and only for rows both travellers confirmed as "falsch". Ordinary sharing keeps "deletes never propagate".
   - Afterwards both trips form one share group, so later changes sync as usual.
   - **Undo:** before applying, each server keeps a snapshot of its trip. "Zusammenlegen rückgängig" is offered while nothing has changed on the trip since the merge (the same stale check as `sharing/undo.ts`). It restores that server's trip alone and leaves the share group; it does not undo anything on the other server.

### C.3 Places in a merge

- A merge that includes places hands over, per accepted visit:
  - the place itself: name, coordinates, category, country — a new catalogue row on the receiving side, or a match to an existing one;
  - the visit date.
- Notes, photos and ratings of the visit stay private, as they do for every other type.
- This needs the owner's answer (§5 Q1): it narrows owner decision 2 for this one, explicitly confirmed act.

### C.4 Phases (after A, after the answers)

- C1: the propose/accept handshake and the fact exchange. Read-only comparison screen, nothing applied.
- C2: rule-based proposals and evidence summaries.
- C3: decide/confirm and apply on both servers, with snapshot/undo.
- C4: AI audit for the open rows.
- C5: places in a merge (if Q1 is yes).
- Behind a beta key `tripMerge` until it has been run across two real servers (as O10 was).

---

### C.5 Scope limits of the first version

- Only two trips that are not yet in a share group. A trip already shared with others cannot be merged: their approval would be needed too (§5 Q8).

## 5. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | May a merge hand over place visits (place + day, no notes/photos), narrowing "a place visit is the visitor's own" for this one act? | **Yes**, per merge with its own tick "Orte einbeziehen", default on. |
| Q2 | Who must confirm a merge result: both travellers per row, or one decides and the other only accepts the whole result? | **Both, per row.** It is the only case where a delete crosses servers. |
| Q3 | Is the "AI audit" a step inside the merge (as proposed), or a feature of its own that also checks a single trip for gaps and contradictions? | **Inside the merge first** (C4). A single-trip audit can reuse it later. |
| Q4 | Which AI may see the facts of the other traveller's trip? Only a local model (Ollama), or also a cloud provider if one is configured? | **Local only by default**, a cloud provider only when both travellers allow it. |
| Q5 | PhotoPrism: may both Immich and PhotoPrism be connected at the same time? | **Yes.** The album picker then asks which source. |
| Q6 | Can a merge also run between two accounts on the SAME server? | **Yes**, the same flow without the federation hop. It is also the cheaper way to test it. |
| Q7 | "N Orte" on a trip: distinct places or visits, and planned visits too? | **Distinct places, visited only** (planned ones are listed but not counted). |
| Q8 | May a trip that is already shared with others be merged? | **No in the first version.** Every member of the group would have to agree. |
| Q9 | May the evidence summary cross servers (document type and date, how an entry was entered, the NUMBER of photos and whether a track exists)? It is more than the facts that travel today; the documents themselves never travel. | **Yes**, only during a merge and only these summaries. |
| Q10 | Places taken over in a merge: a one-time copy, or synced from then on like the other facts? | **One-time copy**: the place then belongs to each side. Later visits stay private, as decision 2 says. |
