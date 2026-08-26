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
      {
        name: "beta-channel",
        kind: "text",
        topic: "Beta builds (-beta.N) from the forward dev line — early feature testing.",
      },
      {
        name: "release-candidate",
        kind: "text",
        topic: "Release candidates (-rc.N) — the build lined up to ship, final testing.",
      },
      { name: "beta-feedback", kind: "text", topic: "Feedback + bug reports for beta and RC builds." },
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
