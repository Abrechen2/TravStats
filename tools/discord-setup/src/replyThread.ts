import { Client, ForumChannel, ThreadChannel } from "discord.js";
import { log } from "./log.js";

/**
 * Collect every forum thread (posts) in the guild, active + archived, across
 * all forum channels (e.g. #bug-report, #feature-request). Archived threads are
 * fetched best-effort — a missing permission on one forum must not abort the
 * whole lookup.
 */
async function collectForumThreads(forums: ForumChannel[]): Promise<ThreadChannel[]> {
  const threads: ThreadChannel[] = [];
  for (const forum of forums) {
    const active = await forum.threads.fetchActive().catch(() => null);
    const archived = await forum.threads.fetchArchived().catch(() => null);
    if (active) threads.push(...active.threads.values());
    if (archived) threads.push(...archived.threads.values());
  }
  return threads;
}

/**
 * Resolve a user-supplied query to exactly one forum thread. Matches an exact
 * thread id first, then a case-insensitive substring of the thread (post)
 * title. Returns the single match, or logs the ambiguity / miss and returns
 * null so the caller can abort without posting.
 */
export function resolveThread(threads: ThreadChannel[], query: string): ThreadChannel | null {
  const byId = threads.find((t) => t.id === query);
  if (byId) return byId;

  const needle = query.toLowerCase();
  const matches = threads.filter((t) => t.name.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0];

  if (matches.length === 0) {
    log(`No forum thread matches "${query}". Open threads:`);
    for (const t of threads) log(`  - "${t.name}"  (id ${t.id})`);
    return null;
  }

  log(`"${query}" is ambiguous — ${matches.length} threads match. Use the id:`);
  for (const t of matches) log(`  - "${t.name}"  (id ${t.id})`);
  return null;
}

/**
 * Post a reply message into a forum thread (e.g. a #bug-report post) identified
 * by id or title substring, then disconnect. One-shot per invocation. With
 * `dryRun`, resolve the thread and print what would be sent without posting —
 * posting to Discord is outward-facing, so previewing first is the safe default.
 */
export async function runReply(
  client: Client,
  token: string,
  guildId: string,
  threadQuery: string,
  message: string,
  dryRun: boolean,
): Promise<void> {
  client.once("clientReady", async () => {
    try {
      const guild = await client.guilds.fetch(guildId);
      const full = await guild.fetch();
      await full.channels.fetch();

      const forums = [...full.channels.cache.values()].filter(
        (c): c is ForumChannel => c instanceof ForumChannel,
      );
      if (forums.length === 0) {
        log("This guild has no forum channels.");
        process.exitCode = 1;
        return;
      }

      const threads = await collectForumThreads(forums);
      const thread = resolveThread(threads, threadQuery);
      if (!thread) {
        process.exitCode = 1;
        return;
      }

      if (dryRun) {
        log(`[dry-run] would post to "${thread.name}" (id ${thread.id}):`);
        log(`[dry-run] ${message}`);
        return;
      }

      const sent = await thread.send(message);
      log(`Posted reply to "${thread.name}" (id ${thread.id}): ${sent.url}`);
    } catch (err) {
      log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await client.destroy();
    }
  });

  await client.login(token);
}
