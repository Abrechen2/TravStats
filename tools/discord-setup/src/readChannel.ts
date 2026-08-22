import { Client, ForumChannel } from "discord.js";
import { log } from "./log.js";

const MAX_FORUM_THREADS = 15;
const DEFAULT_READ_LIMIT = 20;
const MAX_READ_LIMIT = 100;

/** The parts of an embed this reader shows. Structural subset of discord.js'
 *  `Embed`, so a fetched message can be passed straight in. */
export interface ReadableEmbed {
  title?: string | null;
  description?: string | null;
}

/**
 * Format a single fetched message as readable lines. Falls back to a
 * placeholder when the content is empty (which happens if the bot lacks the
 * Message Content intent and the message does not mention it).
 *
 * EMBEDS ARE INCLUDED, and that is the point: every announcement this tool
 * posts is entirely an embed with no message content, so a reader that showed
 * only `content` rendered each one as "(no text content)". Reading the channel
 * back was therefore no verification at all — it could not distinguish a
 * complete announcement from an empty post. Found on 2026-08-22, after
 * reporting an announcement as "verified by reading the channel".
 */
export function formatMessage(
  authorTag: string,
  iso: string,
  content: string,
  embeds: ReadableEmbed[] = []
): string {
  const hasContent = content.trim().length > 0;
  const body = hasContent ? content : embeds.length > 0 ? "(embed only)" : "(no text content)";
  const lines = [`[${iso}] ${authorTag}: ${body}`];
  embeds.forEach((embed, index) => {
    lines.push(`  embed[${index}] title: ${embed.title ?? "(none)"}`);
    const description = embed.description?.trim();
    if (description) {
      for (const line of description.split(/\r?\n/)) lines.push(`    ${line}`);
    } else {
      lines.push("    (no description)");
    }
  });
  return lines.join("\n");
}

/**
 * Parse the CLI `limit` argument for `read`. Missing, non-numeric, non-integer,
 * or below-minimum input falls back to the default (20); above-maximum input
 * is CLAMPED to the maximum (100) rather than silently falling back to the
 * default — the README documents "default 20, max 100", so `read general 500`
 * must return up to 100, not silently drop to 20 with no indication anything
 * was capped.
 */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_READ_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_READ_LIMIT;
  return Math.min(parsed, MAX_READ_LIMIT);
}

/**
 * Read a forum channel: forums hold their posts as threads, so enumerate the
 * threads (active + archived, newest first, capped) and print each thread's
 * messages up to perThreadLimit. Fetching the archived page is best-effort —
 * a permission denial, rate limit or transient network error there must not
 * silently under-report the forum's posts, so it is logged as a warning
 * naming the forum and the underlying error rather than swallowed.
 */
async function readForum(forum: ForumChannel, perThreadLimit: number): Promise<void> {
  const active = await forum.threads.fetchActive();
  const archived = await forum.threads.fetchArchived().catch((err: unknown) => {
    log(
      `WARNING: failed to fetch archived threads in #${forum.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  });
  const threads = [
    ...active.threads.values(),
    ...(archived ? [...archived.threads.values()] : []),
  ];
  if (threads.length === 0) {
    log(`#${forum.name} has no posts yet.`);
    return;
  }

  const shown = threads.slice(0, MAX_FORUM_THREADS);
  const suffix = threads.length > MAX_FORUM_THREADS ? ` of ${threads.length}` : "";
  log(`=== ${shown.length}${suffix} post(s) in forum #${forum.name} ===`);
  for (const thread of shown) {
    log(`\n--- post: "${thread.name}" ---`);
    const messages = await thread.messages.fetch({ limit: perThreadLimit });
    for (const message of [...messages.values()].reverse()) {
      log(
        formatMessage(
          message.author.tag,
          message.createdAt.toISOString(),
          message.content,
          [...message.embeds]
        )
      );
    }
  }
}

/**
 * On-demand reader: log in, fetch the most recent messages of one channel
 * (text channel by name, or all posts of a forum channel) in the target
 * guild, print them oldest-first, then disconnect. Not a persistent
 * connection — one shot per invocation.
 *
 * The returned promise settles only once the work is actually finished: it
 * resolves from inside the `finally`, after `client.destroy()`, not when
 * `client.login()` resolves. discord.js's `login()` resolves on the raw
 * gateway READY dispatch, which fires BEFORE the `clientReady` event this
 * function's work runs on — awaiting `login()` alone would return before the
 * read has even started. A `login()` rejection (e.g. a bad token) rejects
 * this promise directly, since `clientReady` never fires in that case.
 */
export async function runRead(
  client: Client,
  token: string,
  guildId: string,
  channelName: string,
  limit: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    client.once("clientReady", async () => {
      try {
        const guild = await client.guilds.fetch(guildId);
        const full = await guild.fetch();
        await full.channels.fetch();

        const channel = full.channels.cache.find((c) => c.name === channelName);
        if (!channel) {
          log(`Channel #${channelName} not found in the guild.`);
        } else if (channel instanceof ForumChannel) {
          await readForum(channel, limit);
        } else if (!channel.isTextBased()) {
          log(`#${channelName} is not a readable text or forum channel.`);
        } else {
          const messages = await channel.messages.fetch({ limit });
          if (messages.size === 0) {
            log(`#${channelName} has no messages yet.`);
          } else {
            log(`=== last ${messages.size} message(s) in #${channelName} (oldest first) ===`);
            for (const message of [...messages.values()].reverse()) {
              log(
                formatMessage(
                  message.author.tag,
                  message.createdAt.toISOString(),
                  message.content,
                  [...message.embeds]
                ),
              );
            }
          }
        }
      } catch (err) {
        log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        await client.destroy();
        resolve();
      }
    });

    client.login(token).catch((err: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
