# Multi-Domain Foundation — Design

**Date:** 2026-04-19
**Status:** Draft (post-brainstorm)
**Companion spec:** [Cruise module design](2026-04-19-cruise-module-design.md)

## Overview

TravStats is evolving from a flight-only tracker to a multi-domain travel tracker. The first new domain is Cruises; Hotels and POI/custom visits will follow. This spec covers the shared architectural changes that make multi-domain tracking possible without privileging any single domain. The Cruise module is specified separately and depends on the primitives defined here.

## Goals

- Support multiple travel domains (flight, cruise, later hotel and poi) with equal architectural weight. Flights are not a privileged core — they are a peer domain that happens to exist first.
- Allow each user to enable or disable domains. Disabled domains disappear from navigation, dashboards, maps, stats, and achievements without deleting data.
- Share cross-domain concerns (Trip container, overview pages, shared achievements, parser pipeline, setup) without leaking domain-specific assumptions into shared code.
- Keep existing flight data and behavior intact for current users on upgrade.

## Non-goals

- No unified `Activity` polymorphic table. The brainstorm rejected an unused abstraction in favour of separate domain models sharing infrastructure. This spec stays with separate per-domain tables.
- No plugin architecture. Domains are first-class code modules, registered through a small internal registry.
- No Flight model refactor beyond what the new shared infrastructure requires.
- No domain deletion UX. Disable is sufficient for V1.

## Navigation structure

Pattern: shared overview pages + per-domain deep-dive routes.

| Route | Purpose | Domain scope |
| --- | --- | --- |
| `/` (Dashboard) | Aggregated KPIs and recent activity across enabled domains | mixed |
| `/map` | deck.gl / Globe with layer toggles per domain | mixed |
| `/stats` | Statistics with domain filter | mixed |
| `/achievements` | Achievement list, filter by domain + `shared` | mixed |
| `/flights` | Flight list, flight parser entry, flight-specific views | flight |
| `/cruises` | Cruise list, cruise parser entry, ship gallery | cruise |
| `/trips` | Trip container (groups domain entries across types) | mixed |
| `/settings` | Settings page, includes module toggles | mixed |

Nav items for a domain are hidden when that domain is disabled for the user. Overview pages remain visible even when only one domain is enabled — they simply render fewer layers/panels.

## Domain registry

A small module registry lives in `shared/domains.ts` (or equivalent on both backend and frontend) and is the single source of truth about what domains exist and how they introspect themselves.

```typescript
export type DomainKey = "flight" | "cruise" | "hotel" | "poi";

export interface DomainDescriptor {
  key: DomainKey;
  available: boolean;          // false = "coming soon" (hotel, poi in V1)
  i18nKey: string;             // "domain.flight", "domain.cruise", …
  icon: string;                // emoji or icon identifier
  color: string;               // brand accent color
  routePrefix: string;         // "/flights", "/cruises"
  achievementCategories: string[]; // which categories this domain contributes
}

export const DOMAINS: Record<DomainKey, DomainDescriptor> = { … };
export const AVAILABLE_DOMAINS: DomainKey[] = ["flight", "cruise"];
```

Shared code paths (Dashboard KPI cards, map layers, achievement filters) iterate `AVAILABLE_DOMAINS` instead of hard-coding `flight`. Adding hotel later is a descriptor entry + a domain module, nothing in the shared code changes.

## User module toggle

### Schema

New column on `UserSettings`:

```prisma
model UserSettings {
  // …existing fields…
  enabledDomains String[] @default(["flight"]) @map("enabled_domains")
}
```

- Default for new rows: `['flight']` — preserves V1 UX for the existing user base without prejudging what new users want.
- All available domains are togglable, including `flight`. Flights are not architecturally privileged.
- `enabledDomains = []` is a valid (if unusual) state. Dashboard then shows an empty state pointing the user to Settings → Bereiche.

### Disable behavior

When a domain is disabled:

- Its route prefix is hidden from navigation.
- Dashboard cards/panels for that domain are omitted.
- Map layer toggle for that domain is hidden.
- Stats page hides domain-scoped sections.
- Achievement page filters out achievements with that `domain`. Shared achievements stay visible and retain any unlocked state — they are computed against all data in the DB regardless of which domains are currently enabled, because disabling a domain hides it but does not revise history.
- Parser page hides entry points for the disabled domain's document types.

Data in the DB is never deleted on disable. Enabling the domain again restores full visibility.

### Confirmation on disable-with-data

If a user disables a domain that has ≥1 entry, a confirmation modal appears: "You have 3 cruises. Disabling hides them from the UI but does not delete them. Re-enable anytime in Settings." One-click confirm.

## Achievement changes

New column on `Achievement`:

```prisma
model Achievement {
  // …existing fields…
  domain String @default("flight") // "flight" | "cruise" | "shared" | future …
}
```

- `'flight'` — legacy and flight-specific achievements (aircraft spotter, airline loyalty, …)
- `'cruise'` — cruise-specific achievements (defined in the Cruise spec)
- `'shared'` — achievements that count entries across all enabled domains (country count, continent count, multi-modal trips)

Migration: 3–5 country/continent-related existing achievements are upgraded from `'flight'` to `'shared'` — their progress math is extended to count cruise ports too. User-achievement progress is not reset; it is recomputed against the new counter on next login.

UI filter on `/achievements`:

- Default view shows only achievements with `domain ∈ enabledDomains ∪ {'shared'}`.
- A secondary filter chip lets power users see achievements from disabled domains (inspection only, no progress).

## Trip integration

`Trip` already exists in the schema and currently relates to `Flight[]` and `Booking[]`. It will gain a `cruises: Cruise[]` relation in the Cruise spec. The Trip detail page renders a mixed-timeline component (see Cruise detail layout) that accepts heterogeneous events sorted by date, so adding hotels/POIs later is an O(1) change.

No structural changes to `Trip` itself beyond new relations.

## Parser pipeline generalization

The existing parser stack (Ollama / OpenAI / Claude + regex + user-templates) is already domain-agnostic at the transport level; what is flight-specific is the target schema.

Changes:

1. Parser provider interface accepts a target schema discriminator: `"flight" | "cruise" | …`.
2. `ParserTemplate` gets a `domain: DomainKey` column. Existing templates default to `'flight'` on migration.
3. A `CruiseData` Zod schema is added alongside the existing flight extraction schema. The LLM system prompt is updated to branch by target schema.
4. Parser page (`/parser`) gets a domain picker above the upload zone. Invisible if only one domain is enabled.

User-contributed template infrastructure stays unchanged in shape — only gains a `domain` discriminator.

## Dashboard page

- KPI strip: total entries per enabled domain, cumulative distance/days, etc.
- Recent-activity feed: mixed timeline of latest entries with domain-badge indicators.
- Per-domain deep-link cards for quick entry to `/flights`, `/cruises`, etc.
- All aggregations iterate `enabledDomains`. Empty state when none enabled.

## Map page

- Layer toggles at top of map (existing pattern extended): one toggle per enabled domain.
- Mode selector (Routes, Heatmap, Hexagon, Columns, Trips, Globe) stays unchanged; each mode is extended to accept multi-domain input.
- Cruise map layer details are in the Cruise spec (curved sea arcs, port markers with dwell rings, "Days at Sea" pills).

## Stats page

- Domain filter in the page header. Default shows all enabled domains combined.
- Stats sections remain per-concept (countries, airlines/cruise-lines, mode mix, yearly summary). Sections that are flight-only or cruise-only hide when their domain is filtered out.

## Settings page

New section: **Bereiche** / **Modules**.

- One row per domain with icon, title, stats summary, and toggle.
- Coming-soon domains (hotel, poi) render with disabled toggle and "bald"/"später" badge.
- Section is placed near the top of Settings, right after the language/theme section.

## Setup wizard changes

Add a new step (suggested: step 3 of 4, between account and database-seed steps):

- Title: "Was möchtest du tracken?"
- All currently-available domains render as peer checkbox cards. No default is pre-selected mechanically — the cards start unchecked; a soft suggestion ("Flüge sind ein guter Startpunkt") highlights flight.
- Coming-soon domains are rendered in a muted style below, non-interactive.
- User selection writes `enabledDomains` on user creation.
- Empty selection is allowed but a gentle inline hint nudges the user to pick at least one.

## Migration strategy

- Existing users: a one-shot migration sets `enabledDomains = ['flight']` for every pre-existing `UserSettings` row. Zero UI change from their perspective.
- Existing flight achievements: migration sets `domain = 'flight'` on all rows by default; a curated list of country/continent-based codes gets `domain = 'shared'` in the same migration.
- Existing ParserTemplates: `domain = 'flight'` for all.
- No destructive migrations.

## Dependencies on the Cruise spec

- `AVAILABLE_DOMAINS` in the registry expands to include `cruise` once the Cruise spec ships.
- The Cruise spec's models (Cruise, CruiseStop, Ship, Port) live behind the domain registry and do not affect Foundation code.

## Out of scope (V2 candidates)

- Hotel and POI domain modules. Foundation is designed so these drop in without changes to shared code.
- Shared trip-planning features across domains (multi-segment optimization, itinerary suggestions).
- Cross-domain cost aggregation.
- Team/shared accounts (Foundation stays per-user).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Shared code accidentally assumes flight exists | Code review checklist: no `enabledDomains.includes('flight')` checks in shared modules; iterate the registry instead |
| Migration applies wrong `domain` to an existing achievement | Migration is a SQL data-fix with explicit whitelist of shared achievement codes, reviewed before running |
| Disabling flight breaks existing flight-heavy users | Default `enabledDomains = ['flight']` for existing users keeps them identical on upgrade; disable is an explicit user choice with confirmation modal |
| Trip detail timeline component becomes flight-specific | Component accepts a polymorphic event array; domain adapters produce the event shape |

## Branch strategy

All foundation work happens on a local dev branch (proposed name `dev/multi-domain-v1`). No commits land on `main` and no deploy happens until the user explicitly promotes. This is a deliberate deviation from the usual solo-project "commits on main" rule because of the size and risk surface of the refactor.

## Open questions (resolved or deferred)

- *Should `enabledDomains = []` route users somewhere?* → Yes, to `/settings#modules` with an inline explanation. Deferred to implementation detail.
- *Do disabled domains still receive parser inputs (e.g., an email containing a cruise)?* → No, parser entry points are gated on `enabledDomains`. The same email, after the user enables cruise, can be re-imported.
- *Do shared achievements count entries from a disabled domain?* → Yes. Shared achievements always reflect the full DB. Disable only hides UI; it never revokes progress.
