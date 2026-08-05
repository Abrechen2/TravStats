# Navigation submenus + central import hub — design spec

Date: 2026-07-17
Status: approved (owner, 2026-07-17 — Variante B via mockup
https://claude.ai/code/artifact/29c4a574-ee6a-410b-ac81-9c453ef83275)
Release: rides 2.5.0. Frontend-only — no backend, no DB, no API changes.
Branch: feat/nav-submenus-import-hub

## Why

Two Discord asks from the 2026-07-12/13 conversation with Alex, structure decided by the
owner on 07-13 and refined 2026-07-17:

1. The flat top navigation lists up to 10 items for an admin. Domains (flights, cruises,
   later hotels) should group under a neutral **"Logbuch"** parent — deliberately NOT
   under Reisen: a trip is a bracket around records, not a container (the flights table
   has an "Ohne Reise" filter; trip-less flights would hide inside a Trips branch).
2. Imports are scattered: bulk file imports live in a settings section, single-record
   email/PDF parsing lives in the add dialogs, and a dead "TravStats-Excel
   reimportieren" tile survives from the flight-only era (its removal was publicly
   promised to Alex on 07-12).

## Owner decisions (fixed)

- **Variante B** navigation: domains under Logbuch AND a right-side System group.
- Reisen stays a top-level sibling of Logbuch.
- The Bug button stays visible on all breakpoints; Donate/Star/Discord collapse under
  **Support**.
- Submenus honour `useEnabledDomains()`; a parent with exactly one visible child
  collapses to a direct link (no one-item dropdowns).
- Import centralization scope: **bulk file imports central in settings, grouped by
  domain**; single-record email/PDF parsing STAYS in the add dialogs (it is "add one
  record", not bulk import).
- No new cruise CSV bulk import in this block — the hub groups what exists.

## 1. Navigation (Variante B)

### Target structure

Center (desktop):

| Item | Visibility | Notes |
|---|---|---|
| Dashboard | always | unchanged |
| **Logbuch ▾** | ≥1 enabled domain | children: Flüge (`/flights`, domain `flight`), Kreuzfahrten (`/cruises`, domain `cruise`); future domains slot in here |
| Reisen | always | unchanged |
| Statistiken | always | unchanged |
| Achievements | always | unchanged |

Right side:

| Item | Visibility | Notes |
|---|---|---|
| Bug | always | unchanged (opens DiagnosticExportModal) |
| **Support ▾** | always, desktop | children: Donate, Star on GitHub, Discord (external links, unchanged targets) |
| **⚙ System ▾** | always | children: Einstellungen (`/settings`); Updates (`/pending-updates`, red count badge, shown under the EXISTING rule: count > 0 or route active); Admin (`/admin`, admin only); Parser (`/parser`, admin only, Beta badge) |
| username, Logout | always | unchanged |

Rules:

- **Single-child collapse**: if a grouped parent has exactly one visible child, render
  that child as a direct link (label = the child's label) instead of a one-item
  dropdown. Applies to Logbuch (one enabled domain → direct "Flüge" link) AND to
  System: a non-admin with zero pending updates has only Einstellungen visible, so they
  see a direct "Einstellungen" chip instead of a one-item System menu. Support always
  has three children and never collapses.
- **Aggregate badge**: the System trigger carries the pendingUpdatesCount badge (9+ cap,
  same as today) so the warning stays visible while the item lives one level down.
- **Parent active state**: a parent renders active (accent + underline) when any child
  route matches (`Logbuch` active on `/flights`/`/cruises`; `System` active on
  `/settings`/`/pending-updates`/`/admin`/`/parser`).
- **Interaction**: dropdowns open on click (not hover-only); Escape and click-outside
  close; only one dropdown open at a time; `aria-haspopup="menu"`,
  `aria-expanded`, visible focus ring. Route navigation closes the menu.

### Mobile (hamburger panel)

No two-level expanding menus. Submenus become labelled groups:

- Dashboard, then group label "Logbuch" with indented Flüge/Kreuzfahrten, then Reisen,
  Statistiken, Achievements — separator — group label "System" with Einstellungen /
  Updates (badge) / Admin / Parser — separator — group label "Support" with the three
  external links (compact row, as today's footer). Bug stays in the top bar.
- Single-child collapse applies here too: with one enabled domain the group label is
  dropped and the child renders as a plain top-level row.

### Components (file split)

`NavigationBar.tsx` is 475 lines and would grow past the 800 hard cap with dropdowns.
Split:

- `components/Nav/useNavItems.ts` — pure model hook: builds the grouped nav tree from
  `useEnabledDomains()`, `user.isAdmin`, `pendingUpdatesCount`, current route. Applies
  the single-child collapse rule. Returns typed `NavNode[]` (leaf | group). This is the
  unit-test surface.
- `components/Nav/NavDropdown.tsx` — one reusable dropdown (trigger + menu, click/Escape/
  outside-close, aria wiring). Used by Logbuch, Support, System.
- `NavigationBar.tsx` shrinks to composition: bar layout, mobile panel, Bug button,
  logout. The pendingUpdates polling (30 s interval) stays here unchanged.

Existing helpers reused: `useClickOutside`, `useTranslation`, `useEnabledDomains`.

### i18n

New keys in `dashboard` (or `common`) namespace, DE + EN together:
`nav.logbook` ("Logbuch" / "Logbook"), `nav.support` ("Support" / "Support"),
`nav.system` ("System" / "System"). Child labels reuse existing keys
(`dashboard:flights`, `cruise:nav.link`, `dashboard:settings`, …).

## 2. Central import hub

### ImportSection (settings, general tab — already URL-addressable)

`components/Settings/ImportSection.tsx` becomes domain-grouped:

- Group header per domain (icon dot + domain label), rendered only for **enabled**
  domains that have ≥1 bulk import method.
- **Flüge** group: `Fr24ImportTile` + `GenericCsvImportTile` (both exist, unchanged).
- No cruise group yet — cruises have no file-based bulk import today. The grouping
  structure is the extension point; a future cruise/hotel bulk importer adds a group.
- **`RoundTripImportTile` is deleted** — component, its test file, and its now-orphaned
  i18n keys (`settings:import.roundtrip.*`, DE + EN). This fulfils the promised
  `hide-export-reimport-entry` roadmap item. The backend route it called stays untouched
  (out of scope; API consumers are unaffected by a frontend tile removal).

### Domain pages link to the hub

- `FlightsTablePage` gets an "Importieren →" affordance that deep-links to the settings
  import section using the EXISTING section deep-link mechanism (settings sections are
  URL-addressable; the exact URL shape is read from `SettingsPage.tsx` during
  implementation, not invented).
- CruisesPage gets NO link (nothing to link to); its add-chooser email/PDF flow is
  untouched.
- The add dialogs (`FlightLookupStep` email tab, `CruiseAddChooser`,
  `DomainImportPanel`) are explicitly out of scope and stay as they are.

## 3. Testing

- `useNavItems` unit tests: single-child collapse (1 domain → direct link, 2 domains →
  group), System collapse for non-admin with zero updates, admin gating (Admin/Parser
  absent for non-admins), badge aggregation (count surfaces on the System node),
  active-parent derivation.
- `NavigationBar.test.tsx` (exists — adapt): dropdown opens on click, closes on
  Escape/outside click/navigation; Updates entry hidden at count 0 (non-active route);
  mobile panel renders groups.
- `ImportSection` test: renders the Flüge group with exactly the two live tiles; no
  roundtrip tile; group hidden when the flight domain is disabled.
- Full frontend gate (tsc + lint + vitest) before merge; browser UAT of the nav on the
  dev stack (dropdown feel, mobile panel, single-domain collapse) — nav changes are
  exactly the class where green tests can hide a broken-feeling UI.

## 4. Out of scope

- Cruise/hotel CSV bulk importers (new features, not part of the ask).
- Moving email/PDF parse flows out of the add dialogs (owner decided they stay).
- Backend changes of any kind (the roundtrip import API route stays).
- Nav redesign beyond Variante B (no icon set, no reordering of unchanged items).

## 5. Risks / gotchas

- **Domain gating**: every group must derive from `useEnabledDomains()` — never
  hardcode `enabledDomains.includes('flight')` (CLAUDE.md rule; iterate
  `AVAILABLE_DOMAINS`).
- The nav test currently asserts the flat structure — it WILL break; adapt intent, not
  assertions-first.
- `showPendingUpdates` logic (count > 0 || route active) must survive the move into the
  System menu — losing it would either hide an active page's nav state or show a
  permanent empty entry.
- Beta gating: nothing in this block touches `betaFeatures.ts`; the Parser beta badge is
  cosmetic and stays.
- Keep the 30 s pendingUpdates polling exactly as-is (interval + cleanup) — it is easy
  to accidentally duplicate it into the new hook and double-poll.
