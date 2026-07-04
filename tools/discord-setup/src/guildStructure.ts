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

type GuildTextLikeChannelType =
  | ChannelType.GuildText
  | ChannelType.GuildVoice
  | ChannelType.GuildForum
  | ChannelType.GuildAnnouncement;

export function channelTypeFor(kind: ChannelKind, communityEnabled: boolean): GuildTextLikeChannelType {
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
