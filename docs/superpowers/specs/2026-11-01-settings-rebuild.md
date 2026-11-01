# Settings rebuild — build plan (2026-11-01)

Owner, 2026-11-01: „so umsetzen dann" — build the settings area as designed by
Claude Design, round 2.

## Sources (binding, in this order)

1. Owner decisions: `docs/superpowers/specs/2026-10-31-settings-redesign.md`,
   section "Rebuild after the Claude Design round".
2. Design: `ClaudeDesign/handoff/2026-11-01-einstellungen-neu/antwort-runde-2/`
   - `Einstellungen-Konzept.md` — structure (§1), building blocks (§2), mapping of
     every inventory item (§4), all DE/EN copy (§5), old → new address (§6).
   - `settings-data.json` — the same content as data (pages, sections, rows, copy).
   - `Einstellungen.dc.html` — clickable prototype. It shows intent; its behaviour
     is NOT the spec where it contradicts the rules below.
3. Code answers to the designer's questions: `…/Antworten-Rueckfragen.md` (R1–R23)
   and `…/antwort-runde-2/Antworten-Rueckfragen-R2.md` (R2-1…R2-14).
4. Design system: `design/DESIGN_SYSTEM.md`, `design/tokens.json`.

## Deviations from the design (owner, 2026-11-01)

- Account deletion is **immediate**: typed confirmation, then the account and all
  its data are gone. No "Löschung läuft bis …", no cancel. The confirmation offers
  "Meine Daten herunterladen" (existing self-export, forgejo#391) first.
- Routes are English; today's page ids stay (`account`, `display`, `flight`,
  `cruise`, `trips`, `location`, `loyalty`, `data`, `services`); new pages:
  `domains`, `sharing`, `notifications`, `server`, `users`, `backups`,
  `maintenance`, `masterdata`, `about`. Every old `/settings/...` and `/admin/...`
  address redirects per Konzept §6 (fix the order to path?query#hash).

## Rules the build holds (from the Codex review of round 2, not optional)

- A failed save keeps the user's choice; the row shows warn + "Erneut versuchen" /
  "Verwerfen"; Verwerfen restores the last SAVED value. Every immediate write is
  flushed on leaving the page (not only the settings document).
- Groups with explicit save warn before leaving — also when leaving via a search
  hit or the menu.
- Locked means locked: `disabled` + `aria-disabled`, not focusable, reason below
  (demo, admin forbade it, dependency). Demo locks follow the server (R22).
- Dangerous actions always go through the confirmation block (incl. "Öffentliche
  Links erlauben" off). Dialog: focus trap, initial focus on "Abbrechen", Escape
  closes, focus returns, typed word checked.
- Account and server credentials of the same service are separate groups with
  separate endpoints (R2-6); a connection status belongs to its own side.
- No simulated behaviour (the prototype's fake test results) — every status comes
  from a real endpoint, every failure from a real error code with DE/EN copy.
- Domain `d_tour` in the design maps to the `roadtrip` domain switch.

## Packages (order; at most two in parallel)

| # | Package | Depends on |
|---|---|---|
| 1 | Foundation: typed settings registry (pages, sections, rows: id, level, scope, audience admin/all, domain gate, search terms), one menu (Dein Konto / Server · nur Admin / About), English routes + every redirect from §6, search over the registry ("8 von N"), level switch in the sidebar. Existing section components are mounted in their new places unchanged. | — |
| 2 | Building blocks: setting row (B1) with save state (B6), switch/select/input/action variants, scope mark (B8), dependency (B10), background job (B11), confirmation (B9), group save + leave warning, locked semantics. Save behaviour per the rules above. | 1 |
| 3 | Pages: Profil & Anmeldung (incl. Zuhause from home periods, immediate account deletion + backend endpoint), Sprache & Einheiten, Reisearten, Flüge, Kreuzfahrten — on the new blocks, copy from §5. | 2 |
| 4 | Pages: Reisen & Eingang, Teilen, Erinnerungen, Treueprogramme, Daten (incl. backup status for every account, R3). | 2 |
| 5 | Page: Standort. | 2 |
| 6 | Page: Dienste — 31 cards from the catalogue (R7), account rows above, "Alle Konten" server rows below; SMTP/WebDAV/Push/Föderation/GitHub/Ollama models move here. | 2 |
| 7 | Server pages: Server, Nutzer, Sicherungen, Wartung, Stammdaten; old admin pages removed (redirects from 1). | 2, 6 |
| 8 | About, removal of dead components and i18n keys, iPad check 1366/820, full gate. | 3–7 |

Each package: tests for every failure path it draws (CLAUDE.md four defect
classes), DE/EN parity, no new raw palette classes, the file-size ratchet.
