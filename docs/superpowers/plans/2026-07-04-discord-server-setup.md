# Discord Server Setup Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `discord.js` (TypeScript) setup bot at `tools/discord-setup/` that idempotently provisions the TravStats Discord server (categories, channels, roles, permissions, rules/welcome embeds, ✈️ reaction-role) mirroring the Sublarr layout.

**Architecture:** A standalone Node sub-project under `tools/` (like `tools/sea-route-lab`). The server layout lives as immutable data in `config.ts`. Pure planner functions diff desired-vs-existing and are unit-tested with Vitest; thin applier functions call the Discord API and are verified via `--dry-run` + a throwaway test guild. A CLI (`index.ts`) exposes `setup` (one-shot provisioning) and `serve` (persistent reaction-role listener). Forum/announcement channels need Community mode; the applier attempts to enable it and falls back to text channels with a clear instruction if Discord rejects it.

**Tech Stack:** Node 24, TypeScript (strict), discord.js 14.26, dotenv, tsx (run TS directly), Vitest (unit tests for pure functions).

## Global Constraints

- TypeScript `strict: true`; `any` is FORBIDDEN — use `unknown` + type guards.
- Immutability: spread `{...obj, field: value}`, never mutate in place.
- Explicit error handling at every API call; never swallow errors silently.
- File size 200–400 lines ideal, 800 hard maximum.
- English for all code, comments, commit messages. Discord user-facing copy is DE-primary / EN-secondary.
- discord.js version: `^14.26.0`. Node `>=20` (dev machine is 24).
- Role colors (exact hex): Maintainer `#f0a947`, Moderator `#4aa6b0`, Beta-Tester `#7bc47f`.
- Beta reaction emoji: ✈️ (U+2708 U+FE0F).
- Two channel renames vs. Sublarr: `providers → import-help`, `plugin-dev → mobile-app`.
- Commit messages: no attribution/Co-Authored-By trailer (disabled globally for this user).
- Never run `taskkill`; if a port/process is stuck, ask the user.

---

### Task 1: Scaffold the sub-project

**Files:**
- Create: `tools/discord-setup/package.json`
- Create: `tools/discord-setup/tsconfig.json`
- Create: `tools/discord-setup/.gitignore`
- Create: `tools/discord-setup/.env.example`
- Create: `tools/discord-setup/src/log.ts`
- Create: `tools/discord-setup/test/log.test.ts`

**Interfaces:**
- Produces: `log(msg: string): void`, `dryRunLog(msg: string): void` from `src/log.ts`. `dryRunLog` prefixes output with `[dry-run] `.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "travstats-discord-setup",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Idempotent Discord server setup bot for TravStats",
  "scripts": {
    "setup": "tsx src/index.ts setup",
    "setup:dry": "tsx src/index.ts setup --dry-run",
    "serve": "tsx src/index.ts serve",
    "typecheck": "tsc --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "discord.js": "^14.26.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
.env
.state.json
```

- [ ] **Step 4: Create `.env.example`**

```dotenv
# Discord bot token (Bot → Reset Token in the Developer Portal)
DISCORD_BOT_TOKEN=
# Target guild (server) ID — enable Developer Mode, right-click the server → Copy Server ID
DISCORD_GUILD_ID=
```

- [ ] **Step 5: Write the failing test for `log.ts`**

Create `test/log.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { log, dryRunLog } from "../src/log.js";

describe("log", () => {
  it("writes the message verbatim", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  it("dryRunLog prefixes with [dry-run]", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    dryRunLog("would create #rules");
    expect(spy).toHaveBeenCalledWith("[dry-run] would create #rules");
    spy.mockRestore();
  });
});
```

- [ ] **Step 6: Install dependencies and run the test to verify it FAILS**

Run:
```bash
cd tools/discord-setup && npm install && npm test
```
Expected: FAIL — `Cannot find module '../src/log.js'` (module not yet created).

- [ ] **Step 7: Implement `src/log.ts`**

```typescript
export function log(message: string): void {
  console.log(message);
}

export function dryRunLog(message: string): void {
  console.log(`[dry-run] ${message}`);
}
```

- [ ] **Step 8: Run test to verify it PASSES**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add tools/discord-setup
git commit -m "chore(discord-setup): scaffold sub-project"
```

---

### Task 2: Server structure config (immutable data + types)

**Files:**
- Create: `tools/discord-setup/src/config.ts`
- Create: `tools/discord-setup/test/config.test.ts`

**Interfaces:**
- Produces:
  - `type ChannelKind = "text" | "forum" | "announcement" | "voice"`
  - `interface ChannelDef { name: string; kind: ChannelKind; topic?: string; readOnly?: boolean }`
  - `interface CategoryDef { name: string; visibility: "public" | "beta" | "staff"; channels: readonly ChannelDef[] }`
  - `interface RoleDef { name: "Maintainer" | "Moderator" | "Beta-Tester"; color: `#${string}`; admin?: boolean; mod?: boolean }`
  - `const CATEGORIES: readonly CategoryDef[]`
  - `const ROLES: readonly RoleDef[]`
  - `const BETA_REACTION = "✈️"`

- [ ] **Step 1: Write the failing test**

Create `test/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CATEGORIES, ROLES, BETA_REACTION } from "../src/config.js";

describe("config", () => {
  it("defines all seven categories in order", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual([
      "INFO", "COMMUNITY", "SUPPORT", "DEV", "BETA", "STAFF", "VOICE",
    ]);
  });

  it("applies the two Sublarr renames", () => {
    const allChannels = CATEGORIES.flatMap((c) => c.channels.map((ch) => ch.name));
    expect(allChannels).toContain("import-help");
    expect(allChannels).toContain("mobile-app");
    expect(allChannels).not.toContain("providers");
    expect(allChannels).not.toContain("plugin-dev");
  });

  it("marks bug-report and feature-request as forum channels", () => {
    const forums = CATEGORIES
      .flatMap((c) => c.channels)
      .filter((ch) => ch.kind === "forum")
      .map((ch) => ch.name);
    expect(forums).toEqual(["bug-report", "feature-request"]);
  });

  it("restricts BETA and STAFF categories", () => {
    expect(CATEGORIES.find((c) => c.name === "BETA")?.visibility).toBe("beta");
    expect(CATEGORIES.find((c) => c.name === "STAFF")?.visibility).toBe("staff");
  });

  it("has unique channel names across the whole server", () => {
    const names = CATEGORIES.flatMap((c) => c.channels.map((ch) => ch.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("defines three roles with the brand colors", () => {
    expect(ROLES.map((r) => [r.name, r.color])).toEqual([
      ["Maintainer", "#f0a947"],
      ["Moderator", "#4aa6b0"],
      ["Beta-Tester", "#7bc47f"],
    ]);
  });

  it("uses the airplane beta reaction", () => {
    expect(BETA_REACTION).toBe("✈️");
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npm test -- config`
Expected: FAIL — `Cannot find module '../src/config.js'`.

- [ ] **Step 3: Implement `src/config.ts`**

```typescript
export type ChannelKind = "text" | "forum" | "announcement" | "voice";

export interface ChannelDef {
  readonly name: string;
  readonly kind: ChannelKind;
  readonly topic?: string;
  readonly readOnly?: boolean;
}

export type CategoryVisibility = "public" | "beta" | "staff";

export interface CategoryDef {
  readonly name: string;
  readonly visibility: CategoryVisibility;
  readonly channels: readonly ChannelDef[];
}

export interface RoleDef {
  readonly name: "Maintainer" | "Moderator" | "Beta-Tester";
  readonly color: `#${string}`;
  readonly admin?: boolean;
  readonly mod?: boolean;
}

export const BETA_REACTION = "✈️";

export const ROLES: readonly RoleDef[] = [
  { name: "Maintainer", color: "#f0a947", admin: true },
  { name: "Moderator", color: "#4aa6b0", mod: true },
  { name: "Beta-Tester", color: "#7bc47f" },
] as const;

export const CATEGORIES: readonly CategoryDef[] = [
  {
    name: "INFO",
    visibility: "public",
    channels: [
      { name: "rules", kind: "text", readOnly: true, topic: "Server rules — react ✈️ to unlock beta." },
      { name: "welcome", kind: "text", readOnly: true, topic: "Start here." },
      { name: "announcements", kind: "announcement", readOnly: true },
      { name: "changelog", kind: "announcement", readOnly: true, topic: "Release notes mirrored from CHANGELOG.md." },
    ],
  },
  {
    name: "COMMUNITY",
    visibility: "public",
    channels: [
      { name: "showcase", kind: "text", topic: "Show off your travel maps, stats and screenshots." },
      { name: "off-topic", kind: "text" },
      { name: "general", kind: "text" },
    ],
  },
  {
    name: "SUPPORT",
    visibility: "public",
    channels: [
      { name: "bug-report", kind: "forum", topic: "Report bugs. Search first, one issue per post." },
      { name: "install-help", kind: "text", topic: "Docker, reverse proxy, first-run help." },
      { name: "import-help", kind: "text", topic: "Flight/cruise booking parsing, email/PDF import, API keys." },
      { name: "translation", kind: "text", topic: "i18n DE/EN wording and fixes." },
    ],
  },
  {
    name: "DEV",
    visibility: "public",
    channels: [
      { name: "feature-request", kind: "forum", topic: "Propose features. One idea per post." },
      { name: "mobile-app", kind: "text", topic: "TravStatsApp (Expo/RN) feedback and builds." },
      { name: "contributing", kind: "text", topic: "Contributing to the codebase." },
    ],
  },
  {
    name: "BETA",
    visibility: "beta",
    channels: [
      { name: "beta-channel", kind: "text" },
      { name: "beta-feedback", kind: "text" },
    ],
  },
  {
    name: "STAFF",
    visibility: "staff",
    channels: [
      { name: "moderator-only", kind: "text" },
      { name: "mod-chat", kind: "text" },
      { name: "mod-log", kind: "text" },
    ],
  },
  {
    name: "VOICE",
    visibility: "public",
    channels: [
      { name: "General", kind: "voice" },
      { name: "Pair-Programming", kind: "voice" },
    ],
  },
] as const;
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npm test -- config`
Expected: PASS (7 tests). Also run `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add tools/discord-setup/src/config.ts tools/discord-setup/test/config.test.ts
git commit -m "feat(discord-setup): define server structure config"
```

---

### Task 3: Rules & welcome embed content (DE/EN)

**Files:**
- Create: `tools/discord-setup/src/content.ts`
- Create: `tools/discord-setup/test/content.test.ts`

**Interfaces:**
- Consumes: `EmbedBuilder` from `discord.js`.
- Produces:
  - `buildRulesEmbed(): EmbedBuilder`
  - `buildWelcomeEmbed(): EmbedBuilder`
  - `RULES_MARKER: string` — a hidden marker string embedded in the rules footer so the setup bot can find/replace its own message idempotently. Value: `"travstats-rules-v1"`.

- [ ] **Step 1: Write the failing test**

Create `test/content.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildRulesEmbed, buildWelcomeEmbed, RULES_MARKER } from "../src/content.js";

describe("content", () => {
  it("rules embed carries the idempotency marker in the footer", () => {
    const data = buildRulesEmbed().toJSON();
    expect(data.footer?.text).toContain(RULES_MARKER);
  });

  it("rules embed lists all seven rules and the escalation line", () => {
    const text = JSON.stringify(buildRulesEmbed().toJSON());
    for (const n of ["1.", "2.", "3.", "4.", "5.", "6.", "7."]) {
      expect(text).toContain(n);
    }
    expect(text).toContain("Warnung");
    expect(text).toContain("Ban");
  });

  it("rules embed mentions the airplane beta reaction in DE and EN", () => {
    const text = JSON.stringify(buildRulesEmbed().toJSON());
    expect(text).toContain("✈️");
    expect(text.toLowerCase()).toContain("beta");
  });

  it("rules embed includes an English mirror", () => {
    const text = JSON.stringify(buildRulesEmbed().toJSON());
    expect(text).toContain("Be respectful");
    expect(text).toContain("Sei respektvoll");
  });

  it("welcome embed names TravStats and links docs", () => {
    const text = JSON.stringify(buildWelcomeEmbed().toJSON());
    expect(text).toContain("TravStats");
    expect(text).toContain("travstats.de/docs");
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npm test -- content`
Expected: FAIL — `Cannot find module '../src/content.js'`.

- [ ] **Step 3: Implement `src/content.ts`**

```typescript
import { EmbedBuilder } from "discord.js";

export const RULES_MARKER = "travstats-rules-v1";

const RULES_DE = [
  "**1. Sei respektvoll** — keine Beleidigungen, Belästigung oder Hassrede.",
  "**2. Schütze private Daten** — keine fremden Buchungsdaten, PNRs, Namen, Adressen oder API-Keys in Screenshots/Logs. Schwärze persönliche Infos.",
  "**3. Sprache** — DE und EN. Andere Sprachen gern in privaten Threads.",
  "**4. Poste im richtigen Channel** — Bugs zuerst auf GitHub melden.",
  "**5. Kein Spam / keine aufdringliche Eigenwerbung** — offensichtliche Ads werden entfernt.",
  "**6. Keine sensiblen Daten teilen** — keine API-Keys, IPs oder Zugangsdaten in geposteten Logs.",
  "**7. Mods haben das letzte Wort** — halte dich dran, bei Uneinigkeit den Maintainer per DM kontaktieren.",
].join("\n");

const RULES_EN = [
  "**1. Be respectful** — no insults, harassment, or hate speech.",
  "**2. Protect private data** — no third-party booking data, PNRs, names, addresses or API keys in screenshots/logs. Redact personal info.",
  "**3. Language** — DE and EN. Other languages welcome in private threads.",
  "**4. Post in the right channel** — file bugs on GitHub first.",
  "**5. No spam / heavy self-promotion** — blatant ads are removed.",
  "**6. No sensitive data** — no API keys, IPs or credentials in posted logs.",
  "**7. Mods have the final say** — comply and DM the maintainer if you disagree.",
].join("\n");

export function buildRulesEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("📋 Serverregeln / Server Rules")
    .setColor(0xf0a947)
    .addFields(
      { name: "Regeln (DE)", value: RULES_DE },
      { name: "Eskalation", value: "Verwarnung → Timeout → Kick → Ban." },
      { name: "Beta", value: "Reagiere mit ✈️, um die **Beta-Tester**-Channels freizuschalten." },
      { name: "Rules (EN)", value: RULES_EN },
      { name: "Escalation", value: "Warning → Timeout → Kick → Ban. React with ✈️ to unlock the Beta-Tester channels." },
    )
    .setFooter({ text: RULES_MARKER });
}

export function buildWelcomeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Willkommen bei TravStats / Welcome to TravStats")
    .setColor(0xf0a947)
    .setDescription(
      [
        "**TravStats** ist ein selbst-gehostetes Reise-Logbuch (Flights, Cruises & mehr).",
        "TravStats is a self-hosted travel logbook (flights, cruises & more).",
        "",
        "🔗 GitHub: https://github.com/abrechen2/travstats",
        "📖 Docs: https://travstats.de/docs/",
        "",
        "➡️ Lies die <#rules> und frag bei Setup-Fragen in **#install-help**.",
        "➡️ Read the rules and ask setup questions in **#install-help**.",
      ].join("\n"),
    )
    .setFooter({ text: "travstats-welcome-v1" });
}
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npm test -- content`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/discord-setup/src/content.ts tools/discord-setup/test/content.test.ts
git commit -m "feat(discord-setup): add rules and welcome embeds (DE/EN)"
```

---

### Task 4: Role provisioning (planner + applier)

**Files:**
- Create: `tools/discord-setup/src/roles.ts`
- Create: `tools/discord-setup/test/roles.test.ts`

**Interfaces:**
- Consumes: `ROLES`, `RoleDef` from `config.js`; `Guild`, `PermissionFlagsBits` from `discord.js`.
- Produces:
  - `interface RoleAction { name: string; op: "create" | "patch" | "skip" }`
  - `planRoles(existingNames: readonly string[]): RoleAction[]` — pure; `create` if the role name is absent, else `patch`.
  - `permissionsFor(role: RoleDef): bigint` — pure; Administrator bitfield for admin, the mod permission set for mod, else `0n`.
  - `async ensureRoles(guild: Guild, dryRun: boolean): Promise<void>` — applies the plan against the live guild.

- [ ] **Step 1: Write the failing test**

Create `test/roles.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import { planRoles, permissionsFor } from "../src/roles.js";

describe("planRoles", () => {
  it("creates roles that don't exist and patches ones that do", () => {
    const actions = planRoles(["Moderator"]);
    expect(actions.find((a) => a.name === "Moderator")?.op).toBe("patch");
    expect(actions.find((a) => a.name === "Maintainer")?.op).toBe("create");
    expect(actions.find((a) => a.name === "Beta-Tester")?.op).toBe("create");
  });
});

describe("permissionsFor", () => {
  it("gives the Maintainer Administrator", () => {
    expect(permissionsFor({ name: "Maintainer", color: "#f0a947", admin: true }))
      .toBe(PermissionFlagsBits.Administrator);
  });

  it("gives the Beta-Tester no permissions", () => {
    expect(permissionsFor({ name: "Beta-Tester", color: "#7bc47f" })).toBe(0n);
  });

  it("gives the Moderator kick + ban + moderate", () => {
    const perms = permissionsFor({ name: "Moderator", color: "#4aa6b0", mod: true });
    expect((perms & PermissionFlagsBits.KickMembers) === PermissionFlagsBits.KickMembers).toBe(true);
    expect((perms & PermissionFlagsBits.BanMembers) === PermissionFlagsBits.BanMembers).toBe(true);
    expect((perms & PermissionFlagsBits.ModerateMembers) === PermissionFlagsBits.ModerateMembers).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npm test -- roles`
Expected: FAIL — `Cannot find module '../src/roles.js'`.

- [ ] **Step 3: Implement `src/roles.ts`**

```typescript
import { Guild, PermissionFlagsBits } from "discord.js";
import { ROLES, RoleDef } from "./config.js";
import { log, dryRunLog } from "./log.js";

export interface RoleAction {
  readonly name: string;
  readonly op: "create" | "patch" | "skip";
}

const MOD_PERMS: bigint =
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.ViewAuditLog;

export function permissionsFor(role: RoleDef): bigint {
  if (role.admin) return PermissionFlagsBits.Administrator;
  if (role.mod) return MOD_PERMS;
  return 0n;
}

export function planRoles(existingNames: readonly string[]): RoleAction[] {
  const existing = new Set(existingNames);
  return ROLES.map((r) => ({
    name: r.name,
    op: existing.has(r.name) ? "patch" : "create",
  }));
}

export async function ensureRoles(guild: Guild, dryRun: boolean): Promise<void> {
  const roles = await guild.roles.fetch();
  const plan = planRoles(roles.map((r) => r.name));
  for (const def of ROLES) {
    const action = plan.find((a) => a.name === def.name);
    const perms = permissionsFor(def);
    if (action?.op === "create") {
      if (dryRun) {
        dryRunLog(`create role ${def.name} (${def.color})`);
        continue;
      }
      await guild.roles.create({ name: def.name, color: def.color, permissions: perms, reason: "TravStats setup" });
      log(`created role ${def.name}`);
    } else {
      const existing = roles.find((r) => r.name === def.name);
      if (!existing) continue;
      if (dryRun) {
        dryRunLog(`patch role ${def.name}`);
        continue;
      }
      await existing.setColors({ primaryColor: def.color });
      await existing.setPermissions(perms, "TravStats setup");
      log(`patched role ${def.name}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npm test -- roles`
Expected: PASS (4 tests). Run `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add tools/discord-setup/src/roles.ts tools/discord-setup/test/roles.test.ts
git commit -m "feat(discord-setup): provision roles idempotently"
```

---

### Task 5: Channel & category provisioning (planner + applier + community fallback)

**Files:**
- Create: `tools/discord-setup/src/guildStructure.ts`
- Create: `tools/discord-setup/test/guildStructure.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES`, `ChannelDef`, `CategoryDef`, `ChannelKind` from `config.js`; `Guild`, `ChannelType`, `PermissionFlagsBits`, `OverwriteResolvable` from `discord.js`.
- Produces:
  - `channelTypeFor(kind: ChannelKind, communityEnabled: boolean): ChannelType` — pure; maps `forum`/`announcement` to text when community is off.
  - `interface ChannelAction { name: string; op: "create" | "skip" }`
  - `planChannels(existingNames: readonly string[]): ChannelAction[]` — pure.
  - `async ensureStructure(guild: Guild, dryRun: boolean): Promise<{ rulesChannelId: string | null }>` — creates categories then channels with parent + overwrites; returns the resolved `#rules` channel id for Task 6.

- [ ] **Step 1: Write the failing test**

Create `test/guildStructure.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ChannelType } from "discord.js";
import { channelTypeFor, planChannels } from "../src/guildStructure.js";

describe("channelTypeFor", () => {
  it("maps text/voice regardless of community mode", () => {
    expect(channelTypeFor("text", false)).toBe(ChannelType.GuildText);
    expect(channelTypeFor("voice", false)).toBe(ChannelType.GuildVoice);
  });

  it("maps forum and announcement to their real types when community is on", () => {
    expect(channelTypeFor("forum", true)).toBe(ChannelType.GuildForum);
    expect(channelTypeFor("announcement", true)).toBe(ChannelType.GuildAnnouncement);
  });

  it("falls back to text when community is off", () => {
    expect(channelTypeFor("forum", false)).toBe(ChannelType.GuildText);
    expect(channelTypeFor("announcement", false)).toBe(ChannelType.GuildText);
  });
});

describe("planChannels", () => {
  it("skips channels that already exist", () => {
    const actions = planChannels(["general", "rules"]);
    expect(actions.find((a) => a.name === "general")?.op).toBe("skip");
    expect(actions.find((a) => a.name === "rules")?.op).toBe("skip");
    expect(actions.find((a) => a.name === "showcase")?.op).toBe("create");
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npm test -- guildStructure`
Expected: FAIL — `Cannot find module '../src/guildStructure.js'`.

- [ ] **Step 3: Implement `src/guildStructure.ts`**

```typescript
import {
  Guild,
  ChannelType,
  PermissionFlagsBits,
  OverwriteResolvable,
  CategoryChannel,
} from "discord.js";
import { CATEGORIES, CategoryDef, ChannelDef, ChannelKind } from "./config.js";
import { log, dryRunLog } from "./log.js";

export interface ChannelAction {
  readonly name: string;
  readonly op: "create" | "skip";
}

export function channelTypeFor(kind: ChannelKind, communityEnabled: boolean): ChannelType {
  switch (kind) {
    case "voice":
      return ChannelType.GuildVoice;
    case "forum":
      return communityEnabled ? ChannelType.GuildForum : ChannelType.GuildText;
    case "announcement":
      return communityEnabled ? ChannelType.GuildAnnouncement : ChannelType.GuildText;
    case "text":
    default:
      return ChannelType.GuildText;
  }
}

export function planChannels(existingNames: readonly string[]): ChannelAction[] {
  const existing = new Set(existingNames);
  return CATEGORIES.flatMap((cat) =>
    cat.channels.map((ch) => ({
      name: ch.name,
      op: existing.has(ch.name) ? ("skip" as const) : ("create" as const),
    })),
  );
}

function roleId(guild: Guild, name: string): string | null {
  return guild.roles.cache.find((r) => r.name === name)?.id ?? null;
}

function categoryOverwrites(guild: Guild, cat: CategoryDef): OverwriteResolvable[] {
  const everyone = guild.roles.everyone.id;
  const mod = roleId(guild, "Moderator");
  const maintainer = roleId(guild, "Maintainer");
  const beta = roleId(guild, "Beta-Tester");
  const staff = [mod, maintainer].filter((id): id is string => id !== null);

  if (cat.visibility === "staff") {
    return [
      { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
      ...staff.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel] })),
    ];
  }
  if (cat.visibility === "beta") {
    const allowIds = [beta, ...staff].filter((id): id is string => id !== null);
    return [
      { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
      ...allowIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel] })),
    ];
  }
  return [];
}

async function ensureCategory(guild: Guild, cat: CategoryDef, dryRun: boolean): Promise<CategoryChannel | null> {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === cat.name,
  ) as CategoryChannel | undefined;
  if (existing) return existing;
  if (dryRun) {
    dryRunLog(`create category ${cat.name}`);
    return null;
  }
  const created = await guild.channels.create({
    name: cat.name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: categoryOverwrites(guild, cat),
    reason: "TravStats setup",
  });
  log(`created category ${cat.name}`);
  return created;
}

async function ensureChannel(
  guild: Guild,
  parent: CategoryChannel | null,
  cat: CategoryDef,
  ch: ChannelDef,
  communityEnabled: boolean,
  dryRun: boolean,
): Promise<string | null> {
  const existing = guild.channels.cache.find(
    (c) => c.name === ch.name && c.type !== ChannelType.GuildCategory,
  );
  if (existing) {
    log(`skip existing channel #${ch.name}`);
    return existing.id;
  }
  if (dryRun || !parent) {
    dryRunLog(`create #${ch.name} (${ch.kind}) in ${cat.name}`);
    return null;
  }
  const overwrites = categoryOverwrites(guild, cat);
  if (ch.readOnly) {
    overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] });
  }
  const created = await guild.channels.create({
    name: ch.name,
    type: channelTypeFor(ch.kind, communityEnabled),
    parent: parent.id,
    topic: ch.kind === "voice" ? undefined : ch.topic,
    permissionOverwrites: overwrites,
    reason: "TravStats setup",
  });
  log(`created #${ch.name}`);
  return created.id;
}

export async function ensureStructure(
  guild: Guild,
  dryRun: boolean,
): Promise<{ rulesChannelId: string | null }> {
  await guild.channels.fetch();
  const communityEnabled = guild.features.includes("COMMUNITY");
  if (!communityEnabled) {
    log("Community mode is OFF — bug-report/feature-request/announcements will be created as text channels.");
    log("Enable Community in Server Settings → Enable Community, then re-run to upgrade them.");
  }
  let rulesChannelId: string | null = null;
  for (const cat of CATEGORIES) {
    const parent = await ensureCategory(guild, cat, dryRun);
    for (const ch of cat.channels) {
      const id = await ensureChannel(guild, parent, cat, ch, communityEnabled, dryRun);
      if (ch.name === "rules") rulesChannelId = id;
    }
  }
  return { rulesChannelId };
}
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npm test -- guildStructure`
Expected: PASS (4 tests). Run `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add tools/discord-setup/src/guildStructure.ts tools/discord-setup/test/guildStructure.test.ts
git commit -m "feat(discord-setup): provision categories and channels with permissions"
```

---

### Task 6: Rules message posting, pin, reaction & state persistence

**Files:**
- Create: `tools/discord-setup/src/rulesMessage.ts`
- Create: `tools/discord-setup/src/state.ts`
- Create: `tools/discord-setup/test/state.test.ts`

**Interfaces:**
- Consumes: `buildRulesEmbed`, `buildWelcomeEmbed`, `RULES_MARKER` from `content.js`; `BETA_REACTION` from `config.js`; `Guild`, `TextChannel` from `discord.js`.
- Produces:
  - `interface SetupState { guildId: string; rulesMessageId: string | null }`
  - `readState(): SetupState[]` and `writeState(next: SetupState): void` in `state.ts` — persist to `.state.json` next to the sources.
  - `async postRulesAndWelcome(guild: Guild, rulesChannelId: string | null, dryRun: boolean): Promise<string | null>` in `rulesMessage.ts` — finds its own prior message via `RULES_MARKER`, edits or creates it, pins it, ensures the ✈️ reaction, posts the welcome embed to `#welcome`, and returns the rules message id.

- [ ] **Step 1: Write the failing test for state persistence**

Create `test/state.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { readState, writeState, STATE_PATH } from "../src/state.js";

afterEach(() => {
  if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
});

describe("state", () => {
  it("returns an empty array when no state file exists", () => {
    expect(readState()).toEqual([]);
  });

  it("round-trips a guild's rules message id", () => {
    writeState({ guildId: "123", rulesMessageId: "456" });
    expect(readState()).toEqual([{ guildId: "123", rulesMessageId: "456" }]);
  });

  it("overwrites the entry for the same guild instead of duplicating", () => {
    writeState({ guildId: "123", rulesMessageId: "456" });
    writeState({ guildId: "123", rulesMessageId: "789" });
    expect(readState()).toEqual([{ guildId: "123", rulesMessageId: "789" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npm test -- state`
Expected: FAIL — `Cannot find module '../src/state.js'`.

- [ ] **Step 3: Implement `src/state.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = join(here, "..", ".state.json");

export interface SetupState {
  readonly guildId: string;
  readonly rulesMessageId: string | null;
}

export function readState(): SetupState[] {
  if (!existsSync(STATE_PATH)) return [];
  const raw = readFileSync(STATE_PATH, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is SetupState =>
      typeof e === "object" && e !== null && "guildId" in e && "rulesMessageId" in e,
  );
}

export function writeState(next: SetupState): void {
  const others = readState().filter((e) => e.guildId !== next.guildId);
  writeFileSync(STATE_PATH, JSON.stringify([...others, next], null, 2), "utf8");
}
```

- [ ] **Step 4: Run test to verify it PASSES**

Run: `npm test -- state`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `src/rulesMessage.ts` (no unit test — verified live in Task 7)**

```typescript
import { Guild, TextChannel, ChannelType } from "discord.js";
import { buildRulesEmbed, buildWelcomeEmbed, RULES_MARKER } from "./content.js";
import { BETA_REACTION } from "./config.js";
import { log, dryRunLog } from "./log.js";

function findTextChannel(guild: Guild, name: string): TextChannel | null {
  const ch = guild.channels.cache.find(
    (c) => c.name === name && c.type === ChannelType.GuildText,
  );
  return ch instanceof TextChannel ? ch : null;
}

export async function postRulesAndWelcome(
  guild: Guild,
  rulesChannelId: string | null,
  dryRun: boolean,
): Promise<string | null> {
  const rules = rulesChannelId
    ? ((await guild.channels.fetch(rulesChannelId)) as TextChannel | null)
    : findTextChannel(guild, "rules");
  const welcome = findTextChannel(guild, "welcome");

  if (dryRun) {
    dryRunLog("post/refresh rules embed + ✈️ reaction, post welcome embed");
    return null;
  }
  if (!rules) {
    log("WARNING: #rules channel not found; skipping rules post.");
    return null;
  }

  const recent = await rules.messages.fetch({ limit: 50 });
  const mine = recent.find(
    (m) => m.author.id === guild.client.user?.id &&
      m.embeds.some((e) => e.footer?.text === RULES_MARKER),
  );

  let messageId: string;
  if (mine) {
    await mine.edit({ embeds: [buildRulesEmbed()] });
    messageId = mine.id;
    log("updated existing rules message");
  } else {
    const sent = await rules.send({ embeds: [buildRulesEmbed()] });
    await sent.pin("TravStats rules");
    messageId = sent.id;
    log("posted rules message");
  }

  const target = await rules.messages.fetch(messageId);
  const reacted = target.reactions.cache.some((r) => r.emoji.name === BETA_REACTION);
  if (!reacted) await target.react(BETA_REACTION);

  if (welcome) {
    const welcomeRecent = await welcome.messages.fetch({ limit: 20 });
    const hasWelcome = welcomeRecent.some(
      (m) => m.author.id === guild.client.user?.id &&
        m.embeds.some((e) => e.footer?.text === "travstats-welcome-v1"),
    );
    if (!hasWelcome) await welcome.send({ embeds: [buildWelcomeEmbed()] });
  }

  return messageId;
}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tools/discord-setup/src/state.ts tools/discord-setup/src/rulesMessage.ts tools/discord-setup/test/state.test.ts
git commit -m "feat(discord-setup): post rules/welcome embeds and persist state"
```

---

### Task 7: CLI entry (`setup` command + `--dry-run`)

**Files:**
- Create: `tools/discord-setup/src/client.ts`
- Create: `tools/discord-setup/src/index.ts`

**Interfaces:**
- Consumes: `ensureRoles` (roles.js), `ensureStructure` (guildStructure.js), `postRulesAndWelcome` (rulesMessage.js), `writeState` (state.js); `Client`, `GatewayIntentBits`, `Partials` from `discord.js`; `dotenv`.
- Produces:
  - `createClient(): Client` in `client.ts` — configured with the intents/partials both `setup` and `serve` need.
  - `loadEnv(): { token: string; guildId: string }` in `client.ts` — reads + validates env, throws with a clear message if missing.
  - `index.ts` — CLI dispatch for `setup` (with optional `--dry-run`) and `serve`.

- [ ] **Step 1: Implement `src/client.ts`**

```typescript
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config as loadDotenv } from "dotenv";

loadDotenv();

export function loadEnv(): { token: string; guildId: string } {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token) throw new Error("DISCORD_BOT_TOKEN is missing — copy .env.example to .env and fill it in.");
  if (!guildId) throw new Error("DISCORD_GUILD_ID is missing — copy .env.example to .env and fill it in.");
  return { token, guildId };
}

export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
}
```

- [ ] **Step 2: Implement `src/index.ts`**

```typescript
import { Client } from "discord.js";
import { createClient, loadEnv } from "./client.js";
import { ensureRoles } from "./roles.js";
import { ensureStructure } from "./guildStructure.js";
import { postRulesAndWelcome } from "./rulesMessage.js";
import { writeState } from "./state.js";
import { runServe } from "./reactionRole.js";
import { log } from "./log.js";

async function runSetup(client: Client, guildId: string, dryRun: boolean): Promise<void> {
  const guild = await client.guilds.fetch(guildId);
  const full = await guild.fetch();
  log(dryRun ? "=== DRY RUN — no changes will be made ===" : "=== TravStats setup ===");
  await ensureRoles(full, dryRun);
  const { rulesChannelId } = await ensureStructure(full, dryRun);
  const rulesMessageId = await postRulesAndWelcome(full, rulesChannelId, dryRun);
  if (!dryRun) writeState({ guildId, rulesMessageId });
  log("done.");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  const { token, guildId } = loadEnv();
  const client = createClient();

  if (command === "serve") {
    await runServe(client, token, guildId);
    return; // serve keeps the process alive
  }

  if (command === "setup") {
    client.once("clientReady", async () => {
      try {
        await runSetup(client, guildId, dryRun);
      } catch (err) {
        log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        await client.destroy();
      }
    });
    await client.login(token);
    return;
  }

  log("Usage: tsx src/index.ts <setup|serve> [--dry-run]");
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  log(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
```

> Note: `index.ts` imports `runServe` from `reactionRole.js`, built in Task 8. To keep this task independently type-checkable, create a minimal stub `src/reactionRole.ts` now: `export async function runServe(): Promise<void> { throw new Error("not implemented"); }` — Task 8 replaces it. (Adjust the `runSetup` call site is unaffected.)

- [ ] **Step 3: Create the stub `src/reactionRole.ts`**

```typescript
import { Client } from "discord.js";
export async function runServe(_client: Client, _token: string, _guildId: string): Promise<void> {
  throw new Error("serve mode not implemented yet");
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Live smoke test against a throwaway test guild**

Create a Discord application + bot in the Developer Portal, invite it to a **fresh empty test server** with Administrator (invite URL in Task 9), fill `.env`, then:

```bash
npm run setup:dry   # review the printed plan — every entity should say create
npm run setup       # actually provision
npm run setup       # run again — everything should say "skip existing" / "patched"/"updated existing rules message"
```
Expected: after the first `setup`, the test server shows all 7 categories, all channels, 3 roles, a pinned rules embed with a ✈️ reaction, and a welcome embed. The second run makes no duplicates.

- [ ] **Step 6: Commit**

```bash
git add tools/discord-setup/src/client.ts tools/discord-setup/src/index.ts tools/discord-setup/src/reactionRole.ts
git commit -m "feat(discord-setup): add CLI setup command with dry-run"
```

---

### Task 8: `serve` mode — ✈️ reaction toggles the Beta-Tester role

**Files:**
- Modify: `tools/discord-setup/src/reactionRole.ts` (replace the stub)

**Interfaces:**
- Consumes: `readState` (state.js); `BETA_REACTION` (config.js); `Client`, `MessageReaction`, `User`, `PartialMessageReaction`, `PartialUser`, `Guild` from `discord.js`.
- Produces: `async runServe(client: Client, token: string, guildId: string): Promise<void>` — logs in, listens for `messageReactionAdd`/`messageReactionRemove` on the persisted rules message, and adds/removes the `Beta-Tester` role.

- [ ] **Step 1: Replace `src/reactionRole.ts`**

```typescript
import {
  Client,
  Guild,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from "discord.js";
import { readState } from "./state.js";
import { BETA_REACTION } from "./config.js";
import { log } from "./log.js";

const BETA_ROLE = "Beta-Tester";

async function toggleBeta(
  guild: Guild,
  userId: string,
  add: boolean,
): Promise<void> {
  const role = guild.roles.cache.find((r) => r.name === BETA_ROLE);
  if (!role) {
    log(`WARNING: ${BETA_ROLE} role not found — run setup first.`);
    return;
  }
  const member = await guild.members.fetch(userId);
  if (add) {
    await member.roles.add(role, "beta ✈️ opt-in");
    log(`+ ${BETA_ROLE} → ${member.user.tag}`);
  } else {
    await member.roles.remove(role, "beta ✈️ opt-out");
    log(`- ${BETA_ROLE} → ${member.user.tag}`);
  }
}

export async function runServe(client: Client, token: string, guildId: string): Promise<void> {
  const state = readState().find((s) => s.guildId === guildId);
  const rulesMessageId = state?.rulesMessageId ?? null;
  if (!rulesMessageId) {
    throw new Error("No rules message id in .state.json — run `npm run setup` first.");
  }

  async function handle(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    add: boolean,
  ): Promise<void> {
    try {
      if (user.bot) return;
      const full = reaction.partial ? await reaction.fetch() : reaction;
      if (full.message.id !== rulesMessageId) return;
      if (full.emoji.name !== BETA_REACTION) return;
      const guild = full.message.guild;
      if (!guild) return;
      await toggleBeta(guild, user.id, add);
    } catch (err) {
      log(`reaction handler error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  client.on("messageReactionAdd", (r, u) => void handle(r, u, true));
  client.on("messageReactionRemove", (r, u) => void handle(r, u, false));
  client.once("clientReady", () => log(`serve mode ready — watching rules message ${rulesMessageId} for ✈️`));

  await client.login(token);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Live smoke test**

With the test guild already provisioned (Task 7) and `.state.json` populated:

```bash
npm run serve
```
In Discord, react ✈️ on the pinned rules message with a non-owner test account → that user gains the Beta-Tester role and the BETA category appears. Remove the reaction → role removed, category disappears. Stop the process with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add tools/discord-setup/src/reactionRole.ts
git commit -m "feat(discord-setup): serve mode toggles Beta-Tester on ✈️ reaction"
```

---

### Task 9: README & final polish

**Files:**
- Create: `tools/discord-setup/README.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `README.md`**

Content must include, verbatim where relevant:

1. **What it does** — one paragraph mirroring the design overview.
2. **Create the bot:**
   - Discord Developer Portal → New Application → Bot → Reset Token → copy into `.env`.
   - Under Bot, enable no privileged intents beyond default (message-content intent is NOT required; reactions work with `GuildMessageReactions`).
3. **Invite URL** (Administrator is simplest for setup):
   ```
   https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot&permissions=8
   ```
   Note: `permissions=8` = Administrator. For least-privilege after setup, the bot only needs Manage Roles + Manage Channels + Read/Send Messages + Add Reactions to run `serve`.
4. **Run:**
   ```bash
   cd tools/discord-setup
   npm install
   cp .env.example .env   # fill in token + guild id
   npm run setup:dry      # preview
   npm run setup          # provision
   npm run serve          # keep running for ✈️ reaction-role
   ```
5. **Community mode note:** forum/announcement channels need Server Settings → Enable Community. If off at setup time, those channels are created as text; enable Community and re-run `npm run setup` to upgrade them.
6. **Idempotency:** re-running `setup` never duplicates; it patches roles, skips existing channels, and edits the existing rules message.
7. **Hosting `serve`:** it must stay running for the reaction-role to work; run it under pm2/systemd or a small container on the same host as TravStats.

- [ ] **Step 2: Full test + typecheck sweep**

Run:
```bash
cd tools/discord-setup && npm test && npm run typecheck
```
Expected: all unit tests pass, no type errors.

- [ ] **Step 3: Commit**

```bash
git add tools/discord-setup/README.md
git commit -m "docs(discord-setup): add setup and hosting README"
```

---

## Notes for the implementer

- The `.js` extensions in imports are correct — this is ESM (`"type": "module"`) with `moduleResolution: Bundler`, and `tsx`/Vitest resolve `./x.js` to `./x.ts`.
- discord.js v14.26 fires `clientReady` (the old `ready` event is deprecated); the plan uses `clientReady`.
- Only Tasks 1–6 and the pure functions in 4–5 have unit tests. Tasks 7 and 8 (live Discord I/O) are verified against a throwaway test guild — there is no offline mock of the Discord gateway, and adding one would test the mock, not the bot.
- Never commit `.env` or `.state.json` (both gitignored in Task 1).
```
