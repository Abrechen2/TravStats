# Discord Server Setup Bot — Design

**Date:** 2026-07-04
**Status:** Approved design → ready for implementation plan
**Owner:** Dennis (Abrechen2)

## 1. Overview

Mirror the Sublarr Discord server structure for TravStats using a scripted,
idempotent setup bot. The Sublarr server was itself bootstrapped by a
"Sublarr Setup APP" bot that created the channel tree, posted a rules embed,
and wired an emoji reaction to a Beta-Tester role. We replicate that pattern,
adapted to the TravStats domains (flights, cruises, mobile app) and the
DE-primary / EN-secondary language policy.

**Deliverable:** a `discord.js` (TypeScript) project at
`tools/discord-setup/` in the TravStats repo, run once against an (empty)
guild with a bot token. It creates categories, channels, roles, permission
overwrites, posts the rules + welcome embeds, and configures an ✈️
reaction-role for Beta-Tester access.

## 2. Goals / Non-Goals

**Goals**
- Reproduce the Sublarr layout 1:1 where it transfers, adapted where the
  domain differs (subtitle-specific channels → travel/import channels).
- Idempotent: re-running updates in place, never duplicates. Match by name.
- Data-driven structure (one config module) so channels/roles are easy to
  edit without touching Discord API plumbing.
- DE-primary / EN-secondary rules + welcome copy.
- ✈️ reaction on the rules message grants the Beta-Tester role (unlocks the
  BETA category); removing the reaction removes the role.

**Non-Goals**
- No moderation/automod features beyond channel + role scaffolding.
- No message-content bot commands (this is a setup/role bot, not a community
  bot).
- No CI/CD wiring for the bot; it is a manual, occasional tool.

## 3. Server Structure (Sublarr → TravStats)

Channel types: `text`, `forum`, `announcement`, `voice`. Forum and
announcement channels plus a designated Rules channel require the guild to be
a **Community server** (see §7).

```
INFO
  #rules            (text; rules embed + ✈️ reaction; @everyone read-only)
  #welcome          (text; welcome embed; read-only)
  #announcements    (announcement; read-only for members)
  #changelog        (announcement; read-only; mirrors CHANGELOG.md releases)

COMMUNITY
  #showcase         (text; users share travel maps / stats / screenshots)
  #off-topic        (text)
  #general          (text)

SUPPORT
  #bug-report       (forum)          [Sublarr parity]
  #install-help     (text)           [Sublarr parity]
  #import-help      (text)           [was `providers`: flight/cruise booking
                                      parsing, API keys, email/PDF import]
  #translation      (text)           [Sublarr parity — i18n DE/EN]

DEV
  #feature-request  (forum)          [Sublarr parity]
  #mobile-app       (text)           [was `plugin-dev`: TravStatsApp Expo/RN]
  #contributing     (text)           [Sublarr parity]

BETA  (visible only to Beta-Tester + Staff)
  #beta-channel     (text)
  #beta-feedback    (text)

STAFF  (visible only to Moderator + Maintainer)
  #moderator-only   (text)
  #mod-chat         (text)
  #mod-log          (text)

VOICE
  General           (voice)
  Pair-Programming  (voice)
```

**Deltas from Sublarr:** `providers → import-help`, `plugin-dev → mobile-app`.
Everything else is a name-for-name mirror.

## 4. Roles

Hierarchy (top → bottom), colors from the TravStats per-domain brand palette:

| Role | Permissions | Color | Notes |
|---|---|---|---|
| **Maintainer** | Administrator | `#f0a947` (flight amber) | Owner role |
| **Moderator** | Kick, Ban, Timeout, Manage Messages, View Audit Log, Manage Threads | `#4aa6b0` (cruise teal) | Staff |
| **Beta-Tester** | (no extra perms) | `#7bc47f` (green) | Grants BETA category view via ✈️ reaction |
| **@everyone** | Default member perms | — | Baseline |

If the Sublarr server has additional roles/colors to mirror exactly, they can
be added to the config later (a roles screenshot was not provided; these four
are inferred from the channel structure + the rules message).

## 5. Permission Overwrites

- **BETA** category: `@everyone` DENY `ViewChannel`; `Beta-Tester` ALLOW
  `ViewChannel`; `Moderator` + `Maintainer` ALLOW `ViewChannel`. Channels
  inherit from the category (synced).
- **STAFF** category: `@everyone` DENY `ViewChannel`; `Moderator` +
  `Maintainer` ALLOW `ViewChannel`.
- **#rules, #welcome**: `@everyone` DENY `SendMessages` (read + react only).
- **#announcements, #changelog**: `@everyone` DENY `SendMessages`, ALLOW
  `ViewChannel` + `AddReactions`.
- All other channels: default (members can post).

## 6. Rules & Welcome Copy

Posted by the setup bot into `#rules` and `#welcome` as embeds. DE primary,
EN mirror. Rule 2 (Sublarr's "No piracy content") is replaced with a
privacy/PII rule appropriate to a travel logbook.

**#rules embed — `📋 Serverregeln / Server Rules`**

DE:
1. **Sei respektvoll** — keine Beleidigungen, Belästigung oder Hassrede.
2. **Schütze private Daten** — keine fremden Buchungsdaten, PNRs, Namen,
   Adressen oder API-Keys in Screenshots/Logs. Schwärze persönliche Infos.
3. **Sprache** — DE und EN. Andere Sprachen gern in privaten Threads.
4. **Poste im richtigen Channel** — Bugs zuerst auf GitHub melden.
5. **Kein Spam / keine aufdringliche Eigenwerbung** — offensichtliche Ads
   werden entfernt.
6. **Keine sensiblen Daten teilen** — keine API-Keys, IPs oder Zugangsdaten
   in geposteten Logs.
7. **Mods haben das letzte Wort** — halte dich dran, bei Uneinigkeit den
   Maintainer per DM kontaktieren.

Eskalation: `Verwarnung → Timeout → Kick → Ban`.

Reagiere mit ✈️, um die **Beta-Tester**-Channels freizuschalten.

EN mirror: same seven rules translated, same escalation line, "React with ✈️
to unlock the Beta-Tester channels."

**#welcome embed — `Willkommen bei TravStats / Welcome to TravStats`**
Short intro: what TravStats is (self-hosted travel logbook), links to GitHub,
docs (travstats.de/docs), and a pointer to `#rules` + `#install-help`.

## 7. Community Mode

Forum channels (`#bug-report`, `#feature-request`), announcement channels,
and a designated Rules channel all require the guild to be a **Community
server**. The setup script will:
1. Attempt to enable Community via the API (`guild.edit` with the required
   `rulesChannel` + `publicUpdatesChannel` + verification/notification
   settings).
2. If Discord rejects the change (it can require manual acknowledgement),
   fall back gracefully: create `#bug-report` / `#feature-request` as **text**
   channels, log a clear instruction to enable Community in Server Settings,
   and note that re-running the script afterward upgrades them to forums.

## 8. Technical Design

### Modes (CLI)
`index.ts` exposes two subcommands:
- **`setup`** (one-shot): create/patch the entire guild structure, post
  embeds, add the ✈️ reaction, persist the rules message ID.
- **`serve`** (persistent, optional): a lightweight listener that toggles the
  Beta-Tester role on `messageReactionAdd` / `messageReactionRemove` for the
  rules message. Needed because a one-shot process cannot listen for
  reactions. Recommended over Discord-native onboarding for Sublarr parity;
  deployable as a tiny always-on process (same host as TravStats, or a small
  container). The plan will decide whether to also offer a native-onboarding
  no-runtime-bot alternative.

### Idempotency
- Roles: fetch by name → create if missing, else patch color/permissions.
- Categories & channels: fetch by name within parent → create if missing,
  else patch type/topic/overwrites.
- Rules message: find the bot-authored message in `#rules` → edit if present,
  else create + pin. Reaction re-added only if absent.
- `--dry-run` flag: log the full plan (create/patch/skip per entity) without
  mutating, for safe preview.

### Config (data-driven)
`src/config.ts` holds the structure as plain immutable data: an ordered list
of categories, each with channels (name, type, topic, overwrites), plus the
role definitions and permission-overwrite rules. The API-plumbing modules
iterate this config — adding a channel later means editing data, not logic.

### Environment
`.env` (gitignored) + `.env.example`:
- `DISCORD_BOT_TOKEN` — bot token (scopes: `bot`, `applications.commands`;
  intents: Guilds, GuildMessageReactions).
- `DISCORD_GUILD_ID` — target server ID.

### File layout
```
tools/discord-setup/
  package.json
  tsconfig.json
  .env.example
  README.md              # bot creation, invite URL, how to run setup/serve
  src/
    index.ts             # CLI entry: setup | serve, --dry-run
    config.ts            # structure definition (immutable data)
    guildStructure.ts    # create/patch categories, channels, overwrites
    roles.ts             # create/patch roles
    content.ts           # rules + welcome embed content (DE/EN)
    reactionRole.ts      # persistent serve-mode listener
    log.ts               # thin console logger with dry-run tagging
```

### Testing
- Pure functions (config → plan diff, embed builders) unit-tested with the
  repo's existing test runner where practical.
- End-to-end verified manually against a throwaway test guild, plus
  `--dry-run` output review before running against the real server.
- No mocking of the live Discord gateway.

## 9. Coding Constraints (repo policy)
- TypeScript `strict: true`; `any` forbidden (`unknown` + guards).
- Immutable data (spread, no in-place mutation).
- Explicit error handling at every API call; never swallow.
- Files 200–400 lines ideal, 800 hard max.
- English for all code/comments/commits; DE-primary + EN for the user-facing
  Discord copy.

## 10. Open Questions
- Persistent `serve` listener vs. Discord-native onboarding for the
  reaction-role — resolved in the implementation plan (leaning: persistent
  listener for Sublarr parity).
- Exact mirror of any additional Sublarr roles/colors — pending a roles
  screenshot; the four inferred roles are sufficient to ship.
