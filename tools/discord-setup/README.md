# TravStats Discord Setup Bot

Standalone `discord.js` (TypeScript) utility for the TravStats Discord server.
It idempotently provisions the server (categories, channels, roles, permission
overwrites, rules/welcome embeds), can read a channel's recent messages on
demand, and posts release/RC announcements. The whole server layout is
described as immutable data in `src/config.ts`, mirroring the Sublarr Discord
layout; pure planner functions diff desired-vs-existing state (unit-tested with
Vitest), and thin applier functions call the Discord API.

Commands (`npm run <name>`):

| Command | What it does |
|---|---|
| `setup` | Provision the server (idempotent). `setup:dry` previews without changes. |
| `read <channel> [limit]` | Print the most recent messages of a text channel. |
| `announce <rc\|release> [version]` | Post a release/RC announcement embed. |
| `reply <thread> <message…>` | Reply in a forum thread (e.g. a `#bug-report` post), matched by id or title substring. `--dry-run` previews without posting. |
| `serve` | Optional: run the ✈️ reaction-role listener (see below). |

## 1. Create the bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application**.
2. Open the **Bot** tab → **Reset Token** → copy the token into `.env`
   (see below). Treat it like a password — never commit it.
3. For `setup`/`announce`/`serve`, no privileged intents are required. For
   `read`, if message **content** comes back empty, enable the **Message
   Content** intent (Bot tab → *Privileged Gateway Intents*) — it is only
   needed to read the text of messages that don't mention the bot.

## 2. Invite the bot to your server

```
https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot&permissions=8
```

Replace `<APP_ID>` with the Application ID from the Developer Portal's
**General Information** tab.

`permissions=8` grants **Administrator**, the simplest option for running
`setup` (it creates categories/channels, roles, permission overwrites, and
posts messages). For least-privilege afterward, the bot needs **Manage
Roles**, **Manage Channels**, **View Channels**, **Send Messages**, **Send
Messages in Threads**, **Read Message History**, and **Embed Links**.

- **Send Messages in Threads** is required by `reply` — forum posts (e.g. a
  `#bug-report` thread) are threads, and plain **Send Messages** does not
  cover posting into one. Without it, `reply` fails on the actual post while
  its resolution/preview step works fine.
- **Embed Links** is required by `announce`, which posts an embed, not plain
  text. Without it, `announce` fails only on the real send — `--dry-run`
  builds and prints the same embed locally without ever touching the
  permission, so a dry run looks perfect right up until the live post 403s.

## 3. Run it

```bash
cd tools/discord-setup
npm install
cp .env.example .env    # fill in DISCORD_BOT_TOKEN + DISCORD_GUILD_ID
npm run setup:dry        # preview — logs every action, makes no changes
npm run setup             # provision the server for real
```

`DISCORD_GUILD_ID` is the target server's ID (enable Developer Mode in
Discord's Advanced settings, then right-click the server icon → **Copy
Server ID**).

## 4. Community mode

Forum channels (`bug-report`, `feature-request`) and announcement channels
(`announcements`, `changelog`) require **Community mode** (Server Settings →
**Enable Community**). If Community mode is off when `setup` runs, those
channels are created as regular text channels and `setup` logs a warning.
Enabling Community mode and re-running `npm run setup` will **not** convert
existing text channels — channels are matched by name and skipped if they
already exist. To get the correct type, enable Community mode, **delete** the
text-created channels, then re-run `npm run setup`.

> Note: enabling Community mode on a fresh server makes Discord create a
> couple of default channels (e.g. a rules and a community-updates channel).
> After `setup`, tidy any leftovers — move/rename or delete the Discord
> defaults so only the intended structure remains.

## 5. Idempotency

`npm run setup` is safe to re-run at any time:

- **Roles** are patched in place (name/color/permissions), never duplicated.
- **Categories and channels** are skipped if a channel with the same name
  already exists anywhere in the guild.
- **The rules and welcome messages** are edited in place (found via a marker
  in their embed footer) instead of posting new ones.

## 6. Reading a channel on demand

```bash
npm run read install-help 50        # text channel: last 50 messages
npm run read feature-request        # forum channel: recent posts + their messages
```

Logs in, prints the channel's recent messages oldest-first, then disconnects
— no persistent connection. For a **text/voice channel** it prints the last
`limit` messages (default 20). For a **forum channel** it lists the recent
posts (threads) and prints each post's messages (up to `limit` per post,
newest 15 posts). Message content is returned via the REST API without the
privileged Message Content intent; if bodies ever show `(no text content)`,
enable that intent (step 1).

## 7. Release & RC announcements

```bash
npm run announce rc 2.3.0-rc.1      # → posts to #beta-channel
npm run announce release 2.3.0      # → posts to #announcements
```

The version argument is optional; without it the bot reads `backend/VERSION`.
The announcement body is taken from the matching `CHANGELOG.md` entry (for an
RC, the `-rc.N` suffix is stripped so it finds the base `X.Y.Z` entry), plus a
link to the GitHub release tag. If no changelog entry is found, it posts a
short notice with the link.

**Deploy/release integration** (see the root `CLAUDE.md`):

- `/deploy` (after the RC is live on prod) → `npm run announce rc <RC_TAG>`
- `/release` (after the GitHub release is published) → `npm run announce release <X.Y.Z>`

## 8. Optional: ✈️ reaction-role (`serve`)

The tool also ships a self-service beta opt-in: a persistent listener that
grants the `Beta-Tester` role when a member reacts ✈️ to the rules message.
**It is not enabled in the current deployment** — the rules embed does not
advertise the ✈️ reaction and `setup` does not post it, because Beta-Tester is
assigned manually. To enable it, re-add the reaction line to
`src/content.ts`/`rulesMessage.ts`, run `setup`, and keep `npm run serve`
running under a process supervisor (`pm2`/`systemd`/a small container) — a bot
only receives reaction events while connected; reactions made while `serve` is
down are not seen retroactively.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test              # vitest --run
```

Pure planner/config/state/changelog/embed functions are unit-tested. The live
Discord I/O (appliers, listeners, read/announce posting) has no offline mock
of the Discord gateway and is verified against a real test guild instead —
mocking the gateway would test the mock, not the bot.
