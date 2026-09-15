# TravStats Design System (web)

Status: baseline written 2026-09-05, owner's instruction "unify everything the
way the Companion app does it". Token source: `design/tokens.json` — a mirror of
`TravStatsCompanion/ClaudeDesign/handoff/tokens.json` v0.7.0. The Companion file
is upstream. The web theme is generated from the mirror, never hand-edited.

This document is the web reading of that token set: what carries over
unchanged, what the web needs in addition (a desktop has hover, keyboard focus,
tables and width), and the rules that govern components. The measured state of
the web app before this system, and the order of the migration, live in the
handover `ClaudeDesign/handoff/2026-09-05-web-vereinheitlichung.md`.

## 1. Principle

One token file, two renderers. The phone app generates `app/src/theme/tokens.ts`
from the JSON; the web generates `frontend/src/theme/tokens.css` (custom
properties plus a Tailwind `@theme` block) from the same JSON. A value that is
not in the JSON is not a design decision, it is an accident.

North star, verbatim from the Companion: **"Ruhiges Instrument"** — dark,
precise, warm. Restrained by default, bold in three signature moments: the globe,
the passport (the one light surface), the year in review.

## 2. Colour

All values from `design/tokens.json → color`, unchanged.

### 2.1 Surfaces and hairline

| Token | Value | Web role |
|---|---|---|
| `canvas` | `#07090c` | page ground behind everything (body background) |
| `bg` | `#0b0d10` | app background, header/nav ground |
| `surface2` | `#101317` | sheets, dialogs, icon buttons, sparse cards — darker than `surface` |
| `surface` | `#14181d` | cards, table rows, KPI tiles, inputs |
| `tile` | `#1a1f26` | inner tiles inside a card, airline monogram box |
| `heroGradient` | `linear-gradient(160deg,#171c22,#12161b)` | hero cards |
| `border` | `rgba(231,227,220,0.12)` | the one hairline, 1px, everywhere |
| `paper` / `paperText` | `#f5f1e8` / `#2a2419` | the passport card only |

Web-only derived values, defined in the generated CSS from the same numbers:
input border at rest `rgba(231,227,220,0.16)`, secondary-button border
`rgba(231,227,220,0.18)`, dialog scrim `rgba(4,6,8,0.6)`, table row hover
`rgba(231,227,220,0.04)`. Nothing else may introduce a fifth grey.

### 2.2 Text

| Token | Value |
|---|---|
| `textBright` | `#f4ece0` — headlines, stat numbers |
| `text` | `#e7e3dc` — body |
| `muted` | `rgba(231,227,220,0.6)` — captions, labels |
| `faint` | `rgba(231,227,220,0.45)` — chevrons, provenance |

The web's old `--text-secondary` (brighter than muted) has no counterpart and is
retired: a text is either `text`, `muted` or `faint`.

### 2.3 Accent

`accent #f0a947` · `accentText #0b0d10` · `accentHover #f6bd66` ·
`accentPressed #d8952f` · `proBg rgba(240,169,71,0.15)`.
The accent means *active, primary, selected, highlighted*. **Never status.** The
web gets real hover and pressed states from the two extra tokens; the old
`--accent-dim #c8842a` is retired.

### 2.4 Semantic states

| Token | Value | Meaning |
|---|---|---|
| `good` | `#5ec2b2` | success, confirmed, "a find" |
| `live` | `#5ec2b2` | happening now — green, never amber |
| `info` | `#6fa0d6` | planned, waiting, **offline** |
| `warn` | `#d8952f` | needs a decision, degraded, unread |
| `bad` | `#e65a4f` | cancelled, destructive, rejected certificate — nothing else |

Two rules the Companion states and the web adopts: an empty or waiting state is
never red; offline is a waiting state (`info`), not an error.

### 2.5 Domain colours

| Domain | Token | Value |
|---|---|---|
| flight | `domainColor.flight` | `#f0a947` amber |
| cruise | `domainColor.cruise` | `#4aa6b0` teal |
| lodging | `domainColor.hotel` | `#5ec2b2` |
| poi | `domainColor.poi` | `#e7e3dc` ink |
| trip | — | a frame, not a domain; no colour of its own |

This is the change with the widest blast radius on the web: today the web
paints cruise `#6fa0d6`, lodging `#d4778f` and poi `#5ec2b2`, so two hues move
to other domains. The user-overridable domain colours (`domainColorStore`,
behind the `domainColors` beta gate) keep working; only the defaults change.
The five further web domains (train, hike, bike, road, ferry) have no Companion
token and keep their current values until the Companion names them; they are
recorded in the generated CSS under a `web.domainColor` group so they stay
visible as an open item rather than a hidden fork.

### 2.6 Status colours and the one pill

`statusColor`: scheduled `#6fa0d6` · pending `#6fa0d6` (dashed) · flown
`#5ec2b2` · cancelled `#e65a4f` · historical `rgba(231,227,220,0.62)` ·
duplicated / review / guess `#d8952f`.

The `statusPill` recipe is binding on both apps: colour as text, background at
12 %, border at 45 %, radius 999, UI font 11px bold uppercase, letter-spacing
0.6px, padding 10×4, **never mono**. Dashed border means provisional. Status is
always a pill, never plain text. One pill per row: status displaces the domain
pill unless the status is flown. The web maps its extra `in_progress` to the
flown colour (as the Companion's `StatusPill` does) and `completed` likewise.

### 2.7 Tiers, charts, lists

`tierColor`: bronze `#f59e0b` · silver `rgba(231,227,220,0.62)` · gold
`#f0a947` · platinum `#22d3ee` · diamond `#a855f7`.

`chartColors`, in order: `#f0a947 #6fa0d6 #5ec2b2 #bc8cff #f778ba #d8952f
#e65a4f #9ec0e8`; `chartMutedBar #2a2f36` for the un-highlighted bar. The web
has no chart palette today; every recharts series takes its colour from this
list by index, the highlighted one from `accent`, grid and axes from `border`
and `muted`. Charts are never clipped at the fold.

`listColor.palette` (ten named colours, `freeHex: false`) replaces the six web
palettes for trips, cruises, flights, lodgings, places and place lists. A user
picks a name, not a hex. The excluded hues (`accent`, `bad`, `info`, `good`,
`cruise`) stay excluded on the web for the same reason: the map reads colour as
meaning.

## 3. Typography

| Role | Family | Weights |
|---|---|---|
| UI | **Hanken Grotesk** | 400 500 600 700 800 |
| Mono | **IBM Plex Mono** | 400 500 600 |
| Serif | **Newsreader** italic only | 400 500 |

Loaded from Google Fonts with `display=swap` and real fallback stacks
(`system-ui` / `ui-monospace` / `Georgia`). Syne and Inter are retired.

### 3.1 Scale (`typography.scale`)

| Role | px / weight | Notes |
|---|---|---|
| `hero` | 42 / 800 | tracking −1px, `tabular-nums`, `textBright` |
| `screenTitle` | 26 / 800 | `textBright` — the one h1 style |
| `greeting` | 30 serif italic | greetings and the create-dialog title only |
| `cardTitle` | 16 / 700 | `text` |
| `statNumber` | 20 / 800 | `tabular-nums`, `textBright`; a stat tile renders it at 28 |
| `body` | 14 / 400 | `text` |
| `caption` | 12 / 400 | `muted` |
| `labelMono` | 11 / 500 mono | uppercase, tracking 0.12em, `muted` — section labels |
| `metaMono` | 10 / 400 mono | `muted` — provenance, attribution |
| `code` | 14 / 500 mono | IATA, flight numbers, measurements |

Each role becomes one utility class (`.t-hero`, `.t-screen-title`, …) in the
generated CSS. A page heading is `.t-screen-title`; the seventeen h1 variants
the web carries today collapse into it.

### 3.2 Mono discipline

Mono is for codes, measurements, times in fact contexts, coordinates, sizes,
zoom levels, diagnostic logs, section labels and UI paths in prose. Mono is
**not** for pills, buttons, names, categories, running text or a number with a
unit inside a sentence. In a mixed line only the code is mono: `LO380` in mono,
`· LOT Polish Airlines` in the UI face at the same size and colour.

Every column of numbers is `tabular-nums`.

## 4. Space, radius, shadow, size

### 4.1 Spacing (`spacing`)

`xs 4 · sm 8 · md 10 · lg 14 · xl 20 · xxl 28`. Screen padding 24. Card gap 10.
Tailwind's four-pixel grid cannot express 10, 14 and 28, so the generated
`@theme` exposes them as named spacing tokens (`--spacing-md` etc.) and the
utilities `p-md`, `gap-lg` follow.

### 4.2 Width — the one web-only decision

The Companion caps content at 480dp because a phone is a column. A desktop
page is not, and a table of flights needs the width. The web keeps three
containers and nothing else:

| Container | Max width | Use |
|---|---|---|
| `reading` | 720px | settings, forms, detail pages, text |
| `list` | 1200px | tables, lists, dashboards |
| `full` | none | maps, the globe |

The ten `max-w-*` values in use today collapse into these three.

### 4.3 Radius (`radius`)

chip/pill 999 · button 12 · tile 14 · card 16 · cardLg 18 · sheet/dialog 26
(dialog: all four corners) · fab 16. No other radius exists. The web's ten
Tailwind radius variants collapse into these named ones.

### 4.4 Shadow (`shadow`)

Four named shadows only: `fab 0 6px 16px rgba(240,169,71,.35)` · `sheet 0 -14px
30px rgba(0,0,0,.5)` (a centred dialog uses it mirrored: `0 14px 30px`) ·
`paperCard 0 14px 30px rgba(0,0,0,.55)` · `focusRing 0 0 0 3px
rgba(240,169,71,.18)`. "Schatten sparsam": a card has none; it has a hairline.

### 4.5 Sizing (`size`)

touch minimum 44 · primary button 52 · secondary button 46 · tab icon 22 ·
fab 48 · airline monogram 34. On the web, the 44px minimum applies to every
pointer target incl. table row actions; a dense table may drop the visual
height to 36 but keeps a 44px hit area.

## 5. Web-specific states

The Companion has press. The web has hover, focus and keyboard, and they are
part of the system, not left to each component:

- **Hover**: buttons go to `accentHover` (primary) or a 4 % lift on `surface`;
  table rows to the row-hover value; links underline. Never a shadow on hover.
- **Focus**: the `focusRing` shadow on every focusable element, visible only
  under `:focus-visible`. No outline removal without the ring.
- **Pressed**: `accentPressed`.
- **Disabled**: opacity 0.5; a disabled create button 0.3 (`formError`).
- **Reduced motion**: `MotionConfig reducedMotion="user"` covers framer; every
  CSS animation gets a `prefers-reduced-motion` guard. Durations: entrance
  180ms, skeleton pulse 750ms, undo window 8000ms.

## 6. Components

The web gets a small primitive library under `frontend/src/components/ui/`.
Every primitive reads tokens only; a page never styles a card, button, pill or
dialog frame itself.

| Primitive | Rule |
|---|---|
| `Button` | two variants, primary (amber fill, 52) and secondary (hairline, 46); `danger` only inside a confirm dialog; never mono; label 16/700 |
| `IconButton` | 44×44, radius 14, `surface2`, hairline |
| `Card` / `Tile` / `HeroCard` | `surface` + hairline radius 16 / `tile` radius 14 / gradient radius 18; no shadow |
| `Pill` / `StatusPill` | the recipe in 2.6; `StatusPill` takes `status` and `domain` |
| `Chip` | filter chip, active = amber fill; max one chip row before a list |
| `SectionLabel` | `labelMono` |
| `StatTile` | tabular number 28 + muted label; chevron only when it leads somewhere |
| `ListRow` / `Table` | 64px rows, leading mark · title + subtitle · trailing pill or chevron; dashed row = unconfirmed |
| `Dialog` | one shell for every overlay: `surface2`, radius 26, scrim, `sheet` shadow, focus trap, Escape, one action max in the footer; the 24 hand-rolled overlays migrate onto it |
| `Input` / `Select` / `Switch` | 44 high, `surface`, hairline at 16 %, `focusRing`; errors as a line under the field, never a toast |
| `EmptyState` | four kinds: nothing (neutral, one primary CTA required), degraded (`warn`, retry, mono log), pending (`info`), unpaired (neutral + warn banner) — never red |
| `Toast` | kept on the web for confirmations only; no icon emoji; never for form errors |
| `PageHeader` | `screenTitle` + optional meta line + action slot; every page uses it |
| `AppShell` | nav + container; a page never imports `NavigationBar` itself |

## 7. Icons

Lucide, 24 grid, stroke 1.8 (2 when active), round caps. Sizes: nav 22, chip
16, chevron 18 in `faint`, empty-state 20 in a 40 tile. **No emoji** as
chrome: the four domain emoji in `shared/domains.ts` and the toast glyphs are
replaced by Lucide names in the same file. Emoji survive in exactly one place,
as in the Companion: a user-chosen place-list icon.

Country flags and airline logos follow the Companion's variant table: flag SVG
30 in lists, 24×17 on the passport card, 21×15 in chips; airline `icon` 40 in
rows, `logo-white` 96×26 in statistics, `tail` only where the admin upstream
exists, always with the monogram fallback in the same box.

## 8. Rules that travel from the Companion unchanged

The six sentences of the Domänen-Charta (2026-09-04) and the four G-rules hold
on the web word for word:

1. No domain is the default. "Flüge" is never the word for entries.
2. Every domain has its mandatory surfaces; a missing one is a defect.
3. No measure is summed across domains; days travelling is the one shared measure.
4. A section disappears only when its domain is empty.
5. Colour belongs to the domain.
6. The trip is the frame, not a sixth domain.

A chevron means "this leads somewhere"; a tile without one is deliberately a
statement. A capped list says what it caps. A container row names count and
measure, in mono. Delete copy has three slots (object · reach · consequence)
and one template. Failure states speak in first person, waiting states in the
future tense; "fehlgeschlagen", "Fehler", "ungültig" are banned.

## 9. What the web keeps deliberately

- Tables. A phone shows rows; the web shows the flights table with sortable
  columns. The table is a primitive, and its cells use the same pills, mono
  codes and tabular numbers.
- Centred dialogs instead of bottom sheets. The shell, radius, scrim, shadow
  and one-action rule are the sheet's; only the placement differs. Below 640px
  the dialog docks to the bottom edge and becomes the sheet.
- A top navigation bar instead of the quickbar. Its content follows
  `useNavItems`; the inbox entry is always present (owner rule 2026-09-05).
- The three map colour modes (`flightColor`, `cruiseColor` stores). They keep
  choosing *which* rule colours a route; the palettes they choose from are the
  token palettes.

## 10. Enforcement

A system that lives only in a document ages like the ones before it. Four
checks land with the migration, in the order the handover gives:

1. `frontend/scripts/generate-theme.mjs` — the generated CSS is a build
   artefact; a test compares it to a fresh generation so nobody hand-edits it.
2. A source scan refusing hex literals outside `theme/` and the map layers
   (ratchet with a frozen list, like the file-size one).
3. A source scan refusing raw Tailwind palette classes (`text-red-500`,
   `bg-slate-800`, …) and `dark:` variants outside `theme/`.
4. A source scan demanding that `fixed inset-0` overlays live only in
   `components/ui/Dialog.tsx`.

## 11. Open — decided by the owner, not in passing

- **Domain hue swap** (2.5): the Companion assignment wins per the owner's
  instruction; BRAND.md §3 on travstats.de must follow, and the marketing
  screenshots with it.
- **Syne**: the marketing site's display face has no Companion slot. The app
  drops it (Hanken Grotesk 800 carries the display roles); whether the site
  keeps it is a brand question for BRAND.md.
- **Five extra domains** (train, hike, bike, road, ferry): need Companion
  tokens before they are final.
- **The contentMax question** (4.2) is answered for the web here; the
  Companion may want the three names too.
- **Outdoor readability of dark-only** stays open on both sides (Companion
  ADR 0002).
