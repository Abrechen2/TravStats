# TravStats Discord Setup Bot

Standalone `discord.js` (TypeScript) setup bot that idempotently provisions
the TravStats Discord server. It creates the categories, channels, roles and
permission overwrites, posts the rules/welcome embeds, and then runs a small
persistent listener that grants the `Beta-Tester` role when a member reacts
✈️ to the rules message (and removes it if they un-react). The whole server
layout is described as immutable data in `src/config.ts`, mirroring the
Sublarr Discord layout; pure planner functions diff desired-vs-existing state
(unit-tested with Vitest), and thin applier functions call the Discord API.

## 1. Create the bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application**.
2. Open the **Bot** tab → **Reset Token** → copy the token into `.env`
   (see below). Treat it like a password — never commit it.
3. No privileged intents need to be enabled beyond the defaults. The
   **Message Content** intent is **not** required — the bot only needs
   `GuildMessageReactions` to detect the ✈️ reaction, which does not require
   a privileged intent.

## 2. Invite the bot to your server

```
https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot&permissions=8
```

Replace `<APP_ID>` with the Application ID from the Developer Portal's
**General Information** tab.

`permissions=8` grants **Administrator**, which is the simplest option for
running `setup` (it needs to create categories/channels, roles, and
permission overwrites, and post messages). For least-privilege after the
initial setup, the bot only needs **Manage Roles**, **Manage Channels**,
**Read Messages/View Channels**, **Send Messages**, and **Add Reactions** to
run `npm run serve` — you can narrow the bot's role permissions down to
those once `setup` has finished.

## 3. Run it

```bash
cd tools/discord-setup
npm install
cp .env.example .env   # fill in DISCORD_BOT_TOKEN + DISCORD_GUILD_ID
npm run setup:dry       # preview — logs every action, makes no changes
npm run setup            # provision the server for real
npm run serve             # keep running for the ✈️ reaction-role
```

`DISCORD_GUILD_ID` is the target server's ID (enable Developer Mode in
Discord's Advanced settings, then right-click the server icon → **Copy
Server ID**).

## 4. Community mode

Forum channels (`bug-report`, `feature-request`) and announcement channels
(`announcements`, `changelog`) require the server to have **Community mode**
enabled (Server Settings → **Enable Community**). If Community mode is off
when `setup` runs, those channels are created as regular text channels
instead — `setup` logs a warning when this happens. Once you enable
Community mode in Server Settings, re-run `npm run setup` to upgrade the
existing channels to the correct forum/announcement type.

## 5. Idempotency

`npm run setup` is safe to re-run at any time:

- **Roles** are patched in place (name/color/permissions), never duplicated.
- **Categories and channels** are skipped if a channel with the same name
  already exists anywhere in the guild — nothing is re-created or
  re-parented.
- **The rules/welcome message** is edited in place (via `.state.json`,
  which records the message ID from the first run) instead of posting a
  new one each time.

This means you can safely re-run `setup` after enabling Community mode, or
after tweaking `src/config.ts`, without ending up with duplicate roles,
channels, or messages.

## 6. Hosting `serve`

`npm run serve` is a long-running process — it must **stay running** for
the ✈️ reaction-role to keep working (a Discord bot only receives gateway
events, like reactions, while its client is connected). It does not exit on
its own. Run it under a process supervisor such as `pm2` or a `systemd`
unit, or inside a small always-on container, ideally on the same host as
the main TravStats deployment. If the process stops, members can still
react to the rules message, but the bot won't see it until `serve` is
started again — no reactions are lost retroactively, since only reactions
recorded from that point onward are read.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test              # vitest --run
```

Only the pure planner/config/state/log functions (Tasks 1–6 of the design)
have unit tests. The live Discord I/O (`setup`'s appliers, `serve`'s
listener) has no offline mock of the Discord gateway and is instead
verified against a throwaway test guild — adding a mock would test the
mock, not the bot.
