# Settings redesign: one home, one row, one save model

Owner, 2026-10-31: "dann bau das so" — build the plan drawn in the design canvas
"Einstellungen – Neuordnung" (claude.ai artifact, private), derived from the Codex
source audit of 2.8.0-rc.5 (`693ed2d29`, 2026-10-31). The audit is the evidence;
this file is the plan and the record of what was built.

## Rules every package follows

1. **One home per setting.** Account settings live under Einstellungen, instance
   settings under Administration. A setting that belongs to its context (map
   panel, import wizard, a single plan or share link) stays there and gets a
   searchable entry in Settings that jumps to it.
2. **One row.** Every setting renders through the shared row (label, help/info,
   scope badge Konto | Instanz | Dieses Gerät, level, control) — a compact
   variant in map panels. Real switch semantics (`role="switch"`,
   `aria-checked`), ≥44 px rows on a coarse pointer.
3. **One save model.** Saved immediately, serialized per setting
   (`store/serializedSetting.ts`), never lost on navigation, and a failed save
   stays on the row with its reason and "Erneut versuchen".
4. **Standard decides, Expert tunes.** Standard: on/off, keys, budgets, consent,
   where data goes. Expert: URLs, models, ports, order, intervals, limits.
   Search reads the level from the same row definitions and never changes the
   account's saved level.
5. **Safe defaults.** Nothing that costs money or sends data to a third party is
   on by default; existing accounts keep their explicit choices.

## Packages (order)

| # | Package | Severity |
|---|---|---|
| 1 | Page autosave survives navigation; pending/failed state on the row | P1 |
| 2 | Immediate preference writes serialized (domains, currency, auto-trips, notifications) | P1 |
| 3 | Standard/Expert reclassification + search metadata from row definitions | P2 |
| 4 | Specialist service forms honour the level; open-data endpoint exposed | P2 |
| 5 | Legacy service editors become status + deep link | P2 |
| 6 | TravPlan instance config: one form | P2 |
| 7 | Contextual discovery (map, dashboard, rail-import memory, sharing); search keeps the level | P2 |
| 8 | Track-map appearance moves to account webPrefs (one-time local migration) | P2 |
| 9 | Map panel controls on the shared row; iPad 1366/820 check | P2 |
| 10 | Copy: parser literals, option labels, level/TravPlan upgrade notes | P3 |
| 11 | Reminders per domain (Alex, Discord 2026-10-29) | P2 |

## Package 11 — reminders per domain (contract, agreed with the Companion)

- Domains: flight, cruise, rail, bus, ferry, lodging.
- Per domain: `{ enabled: boolean, leadHours: number[], channel: "app" | "mail" | "both" }`.
  `leadHours` holds the presets 24 and 2 plus at most one custom value 1–168.
- "App" = server push through the push relay, deduped by the server, for every
  domain. The Companion no longer schedules its own departure reminders; it
  schedules locally only while `push.available` is false for the calling device.
- Per device, returned with the prefs read:
  `push: { available: boolean, reason: "no_relay" | "no_device_token" | "token_rejected" | null }`.
  A token the relay rejects flips it to false for that device.
- Lodging anchor: check-in date at the stored check-in time in the stay's zone;
  without a time 15:00 in the stay's zone; without a zone the account's zone.
- Existing accounts: their current global 24 h / 2 h choice and e-mail switch
  become every domain's value; nothing changes until the user changes it.
- A duplicate reminder while switching between push and fallback is accepted.
- Order: server (migration + resolver + reminders + push) → web page → Companion.

## State

| # | Branch | State |
|---|---|---|
| 1+2 | `fix/settings-save-correctness` | built, pushed to forgejo, awaiting owner merge decision |
