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

export type MessageFetcher = (
  channel: string,
) => Promise<readonly RawMessage[]>;

const FETCH_LIMIT = 50;

/**
 * The real fetcher paired with an explicit teardown. The client is created
 * and logged in lazily on the first `fetch` call and reused for every
 * subsequent channel; `dispose()` destroys it. Safe to call `dispose()` even
 * when `fetch` was never called (no client was ever created).
 */
export interface DiscordFetcher {
  readonly fetch: MessageFetcher;
  readonly dispose: () => Promise<void>;
}

/**
 * Parses an ISO-8601 timestamp into its instant in epoch milliseconds.
 * Returns null when the string cannot be parsed — callers MUST treat that as
 * a hard failure, never as "everything matches" or "nothing matches": a
 * silent fallback in either direction either resurfaces already-triaged
 * messages or drops untriaged ones.
 */
function parseInstant(iso: string): number | null {
  const instant = Date.parse(iso);
  return Number.isNaN(instant) ? null : instant;
}

interface TimedMessage {
  readonly message: DiscordMessage;
  readonly instant: number;
}

/**
 * Everything past a channel's watermark, oldest first. Messages are NOT turned
 * into items here: one tester post routinely carries half a dozen distinct asks,
 * and splitting it is judgement, not parsing. The tool surfaces; an agent splits.
 *
 * Comparisons run on the parsed instant, never on the raw string: real message
 * timestamps always come from `Date.toISOString()` and carry milliseconds
 * ("...:30.500Z"), while a hand-written YAML watermark typically omits them
 * ("...:30Z") or uses a "+00:00" offset. A plain string `>` compare sorts "."
 * before "Z" and would silently drop messages that are genuinely newer, or
 * resurface messages that are exactly already-triaged.
 */
export async function collectDiscord(
  watermarks: readonly DiscordWatermark[],
  fetch: MessageFetcher,
): Promise<CollectorResult<DiscordState>> {
  try {
    const perChannel = await Promise.all(
      watermarks.map(async (mark): Promise<readonly TimedMessage[]> => {
        const markInstant = parseInstant(mark.triagedUpTo);
        if (markInstant === null) {
          throw new Error(
            `Watermark for channel "${mark.channel}" is not a parseable timestamp: "${mark.triagedUpTo}"`,
          );
        }

        const messages = await fetch(mark.channel);
        const timed: TimedMessage[] = [];
        for (const m of messages) {
          const instant = parseInstant(m.timestamp);
          if (instant === null) {
            throw new Error(
              `Message from channel "${mark.channel}" has an unparseable timestamp: "${m.timestamp}"`,
            );
          }
          if (instant > markInstant) {
            timed.push({ message: { ...m, channel: mark.channel }, instant });
          }
        }
        return timed;
      }),
    );

    const untriaged = perChannel
      .flat()
      .sort((a, b) => a.instant - b.instant)
      .map((t) => t.message);

    return { ok: true, data: { untriaged } };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The real fetcher. Reuses the bot credentials from tools/discord-setup/.env.
 * Logs in exactly once (on the first `fetch` call, reused across all
 * channels) rather than once per channel — following the client-lifecycle
 * pattern already established in tools/discord-setup/src/readChannel.ts:
 * register `clientReady` before calling `login`, act only once ready.
 */
export function createDiscordFetcher(envPath: string): DiscordFetcher {
  loadDotenv({ path: envPath });
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  let client: Client | null = null;

  async function ensureClient(): Promise<{
    readonly client: Client;
    readonly guildId: string;
  }> {
    if (!token || !guildId) {
      throw new Error(
        `DISCORD_BOT_TOKEN / DISCORD_GUILD_ID missing — expected them in ${envPath}`,
      );
    }

    if (client === null) {
      const created = new Client({ intents: [GatewayIntentBits.Guilds] });
      await new Promise<void>((resolve, reject) => {
        created.once("clientReady", () => resolve());
        created.login(token).catch(reject);
      });
      client = created;
    }

    return { client, guildId };
  }

  const fetch: MessageFetcher = async (channelName) => {
    const { client: activeClient, guildId: activeGuildId } =
      await ensureClient();
    const guild = await activeClient.guilds.fetch(activeGuildId);
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
  };

  const dispose = async (): Promise<void> => {
    if (client !== null) {
      await client.destroy();
      client = null;
    }
  };

  return { fetch, dispose };
}
