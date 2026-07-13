import { Client, GatewayIntentBits } from "discord.js";
import { config as loadDotenv } from "dotenv";
import type { CollectorResult, DiscordWatermark } from "../types.js";

export interface RawMessage {
  readonly author: string;
  readonly timestamp: string;
  readonly content: string;
  readonly url: string;
}

export interface DiscordMessage extends RawMessage {
  readonly channel: string;
}

export interface DiscordState {
  readonly untriaged: readonly DiscordMessage[];
}

export type MessageFetcher = (channel: string) => Promise<readonly RawMessage[]>;

const FETCH_LIMIT = 50;

/**
 * Everything past a channel's watermark, oldest first. Messages are NOT turned
 * into items here: one tester post routinely carries half a dozen distinct asks,
 * and splitting it is judgement, not parsing. The tool surfaces; an agent splits.
 */
export async function collectDiscord(
  watermarks: readonly DiscordWatermark[],
  fetch: MessageFetcher,
): Promise<CollectorResult<DiscordState>> {
  try {
    const perChannel = await Promise.all(
      watermarks.map(async (mark) => {
        const messages = await fetch(mark.channel);
        return messages
          .filter((m) => m.timestamp > mark.triagedUpTo)
          .map((m) => ({ ...m, channel: mark.channel }));
      }),
    );

    const untriaged = perChannel
      .flat()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return { ok: true, data: { untriaged } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The real fetcher. Reuses the bot credentials from tools/discord-setup/.env.
 */
export function createDiscordFetcher(envPath: string): MessageFetcher {
  loadDotenv({ path: envPath });
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  return async (channelName) => {
    if (!token || !guildId) {
      throw new Error(
        `DISCORD_BOT_TOKEN / DISCORD_GUILD_ID missing — expected them in ${envPath}`,
      );
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    try {
      await client.login(token);
      const guild = await client.guilds.fetch(guildId);
      await guild.channels.fetch();
      const channel = guild.channels.cache.find((c) => c.name === channelName);
      if (!channel?.isTextBased()) return [];

      const messages = await channel.messages.fetch({ limit: FETCH_LIMIT });
      return [...messages.values()].map((m) => ({
        author: m.author.tag,
        timestamp: m.createdAt.toISOString(),
        content: m.content,
        url: m.url,
      }));
    } finally {
      await client.destroy();
    }
  };
}
