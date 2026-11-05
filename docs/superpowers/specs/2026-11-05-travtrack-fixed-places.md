# TravTrack fixed places — server plan and contract

Feature: `travtrack-settings`, part B. App concept:
`TravStatsCompanion/docs/superpowers/specs/2026-11-05-travtrack-settings-and-places-design.md`
(branch `feat/travtrack-settings`). Owner's words: home, work and any number of
other places with a radius; everything inside the radius shows as one point; the
hotel during a booking automatically, adjustable.

## Rules

- Raw points stay stored and stay in every existing response. Folding is a view
  of the day, not a write.
- A privacy zone wins: inside a zone nothing is recorded, so a fixed place that
  overlaps one folds only what was recorded outside it.
- Home has one source. The fixed place `home` is read from the home the server
  already knows (`deriveHomePlace`: the home period's residence, else the legacy
  `homePlace` column) **for the day being shown**, so a past day folds at the
  home valid on that day. `/travtrack/places` stores only home's radius and
  window, never a second home point.
- Additive only: no existing field changes shape.
- Home is not a privacy zone (owner, 2026-11-05: privacy zones are only places
  where nothing is recorded). Checked: the server records and shows points at
  home like anywhere else and creates no zone for it. The one place home is
  cut is a trip route **shared with someone else** (`shareNarrow.ts`: the
  recipient never sees the circle around the owner's current or former
  home) — that is sharing privacy, not recording, and stays.

## Phases

| Phase | Side | What | State |
|---|---|---|---|
| S1 | server | Pairing claim answer gains `user.id` | planned |
| S2 | server | `TravTrackFixedPlace` table, `/travtrack/places` CRUD, home entry, `lodgingAsPlace` setting | planned |
| S3 | server | `/travtrack/day` folds runs inside a fixed place or a lodging into one stop; web shows it | planned |
| B4 | app | Settings → Standort → „Feste Orte“, hotel switch, stop names | after S2/S3 on an RC |

## Contract

### S1 — pairing (`POST /api/v1/pairing/claim`, 201)

`user: { id: string, username: string | null }` — `id` is new. An app that
stored an identity without `id` compares by username (app A7).

### Privacy zones — already there

`PATCH /api/v1/travtrack/zones/:id` exists since 2.7.0: body any of
`{name, lat, lon, radiusM}` (`lat`/`lon` together) plus
`deleteStoredPoints?: boolean`. Use it for A6 edit; no new endpoint.

### S2 — fixed places

`GET /api/v1/travtrack/places` →
`{ places: FixedPlace[], lodgingAsPlace: { enabled: boolean, radiusM: number } }`

```
FixedPlace = {
  id: string            // "home" for the home entry, uuid otherwise
  name: string          // home: the home's name
  kind: "home" | "work" | "custom"
  lat: number | null    // home: null while no home is known
  lon: number | null
  radiusM: number       // 25..2000, default 150
  window: { days: number[] /* 1=Mon..7=Sun, ≥1 entry */, from: "HH:MM", until: "HH:MM" } | null
}
```

- `POST /travtrack/places` body `{name, kind: "work"|"custom", lat, lon, radiusM?, window?}` → 201 `FixedPlace`.
  Any number of `work` and `custom`. `kind: "home"` → 400 `homeIsDerived`.
- `PUT /travtrack/places/:id` full body as POST; for `id = "home"` only
  `{radiusM, window}` are accepted (moving home goes through the existing home
  setting) → 200 `FixedPlace`.
- `DELETE /travtrack/places/:id` → 204; `home` → 400 `homeIsDerived`.
- `PUT /travtrack/places/lodging` body `{enabled, radiusM}` → 200 the setting.
  Default `{enabled: false, radiusM: 150}`.
- Errors: 400 `{error: "validation"|"homeIsDerived"}`, 404 unknown id,
  403 `travtrackDisabled` when the area is off (same gate as the other
  TravTrack routes).
- `window` is read in the place's local zone (from its coordinates); `until`
  earlier than `from` spans midnight.

### S3 — `/travtrack/day`

A run of points inside a fixed place (inside its window, if any) or inside an
active lodging booking's circle (check-in to check-out, booking with
coordinates, setting enabled) becomes **one stop** at the place's point, from
the first to the last point inside. Legs end and start there.

Stop gains (additive), alongside the existing `place`:

```
place: { name, lat, lon, source: "accepted" | "fixed" | "lodging",
         placeId?: string /* fixed: FixedPlace.id */,
         lodgingStayId?: string /* lodging */ } | null
folded: { fixCount: number } | null   // null when the stop was not folded
```

- Precedence on one stop: an accepted name (`source: "accepted"`) the owner
  chose wins over a fixed place, a fixed place over a lodging.
- Overlapping fixed places: the smaller circle wins.
- The points array of the day is unchanged; the web shows the folded fixes on
  demand from it.
- A lodging booking without coordinates is skipped; `/travtrack/places` answer
  carries `lodgingSkipped: number` for the current and upcoming bookings so the
  web can say so (additive on the GET).

### Minimum server version

**2.8.0-rc.25** (live on the RC server since 2026-11-05) carries S1–S3. The app
treats a 404 on `/travtrack/places` as "server too old" and hides B4.

## Open for the app

- Nothing beyond the concept.

## Open for the server

- Whether the web gets its own fixed-places editor in this round or only the
  stop rendering (proposal: stop rendering + a list under TravTrack settings).
