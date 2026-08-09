import { Client, ForumChannel, TextChannel, ThreadChannel } from "discord.js";
import { log } from "./log.js";

/** The minimum a resolver needs. Keeps the resolution logic testable with plain objects. */
interface ThreadLike {
  readonly id: string;
  readonly name: string;
}

/**
 * Collect every forum thread (posts) in the guild, active + archived, across
 * all forum channels (e.g. #bug-report, #feature-request). Fetching either
 * page is best-effort — a permission denial, rate limit or transient network
 * error on one forum must not abort the whole lookup, but it must be visible:
 * silently dropping a forum's threads would make a genuine match report as
 * "nothing matches" with no hint that the search was incomplete.
 */
async function collectForumThreads(forums: ForumChannel[]): Promise<ThreadChannel[]> {
  const threads: ThreadChannel[] = [];
  for (const forum of forums) {
    const active = await forum.threads.fetchActive().catch((err: unknown) => {
      log(
        `WARNING: failed to fetch active threads in #${forum.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
    const archived = await forum.threads.fetchArchived().catch((err: unknown) => {
      log(
        `WARNING: failed to fetch archived threads in #${forum.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
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
export function resolveThread<T extends ThreadLike>(threads: readonly T[], query: string): T | null {
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

/** `resolveThread` without the diagnostics, for use as the first of two lookups. */
function resolveThreadQuietly<T extends ThreadLike>(threads: readonly T[], query: string): T | null {
  const byId = threads.find((t) => t.id === query);
  if (byId) return byId;
  const needle = query.toLowerCase();
  const matches = threads.filter((t) => t.name.toLowerCase().includes(needle));
  return matches.length === 1 ? matches[0] : null;
}

/** True when `item` matches `query` exactly — by id, or by name once a leading `#` is stripped (case-insensitive). */
function isExactMatch(item: ThreadLike, query: string): boolean {
  const needle = query.replace(/^#/, "").toLowerCase();
  return item.id === query || item.name.toLowerCase() === needle;
}

/** One exact-match candidate, tagged with which collection it came from — needed to render it in an ambiguity report. */
export interface ExactMatch<T extends ThreadLike> {
  readonly kind: "thread" | "channel";
  readonly value: T;
}

/**
 * Every exact match (by id, or by exact name once a leading `#` is stripped)
 * across both threads and channels for one query. Exported as its own pure
 * step because "exact beats fuzzy" is exactly the rule `resolveReplyTarget`'s
 * safety rails depend on: a query that exact-matches a text channel must not
 * lose to a thread that only substring-matches it.
 */
export function findExactMatches<T extends ThreadLike, U extends ThreadLike>(
  threads: readonly T[],
  channels: readonly U[],
  query: string,
): Array<ExactMatch<T> | ExactMatch<U>> {
  return [
    ...threads.filter((t) => isExactMatch(t, query)).map((value) => ({ kind: "thread" as const, value })),
    ...channels.filter((c) => isExactMatch(c, query)).map((value) => ({ kind: "channel" as const, value })),
  ];
}

/**
 * Resolve the reply target across both forum threads and text channels, exact
 * matches first. This is the actual safety-critical ordering:
 *
 * 1. Every exact match (by id or exact name) across BOTH collections is
 *    collected first. Exactly one -> that is the target, regardless of
 *    whether a thread also substring-matches the same query.
 * 2. More than one exact match (e.g. a thread named "support" AND a channel
 *    "#support") aborts and lists every candidate — picking one here would be
 *    the same kind of guess the substring rules exist to prevent.
 * 3. Only when there is no exact match anywhere does a unique thread-title
 *    substring win (the existing `resolveThread` behaviour, unchanged). Text
 *    channels never fuzzy-match (see the old `resolveTextChannel` this
 *    replaces), so there is nothing left to try on the channel side once step
 *    1 comes back empty.
 *
 * Without this ordering, a thread that only substring-matches (e.g. "Support
 * ticket: xyz issue") could beat a text channel that matches exactly
 * (`#support`), since the fuzzy resolver ran before the exact one. That
 * silently misdirects a reply into an unrelated public thread.
 */
export function resolveReplyTarget<T extends ThreadLike, U extends ThreadLike>(
  threads: readonly T[],
  channels: readonly U[],
  query: string,
): T | U | null {
  const exact = findExactMatches(threads, channels, query);
  if (exact.length === 1) return exact[0].value;

  if (exact.length > 1) {
    log(`"${query}" is ambiguous — ${exact.length} exact matches across threads and channels. Use the id:`);
    for (const m of exact) log(`  - "${m.value.name}"  (${m.kind}, id ${m.value.id})`);
    return null;
  }

  const quiet = resolveThreadQuietly(threads, query);
  if (!quiet) resolveThread(threads, query); // re-run for its diagnostic output
  return quiet;
}

/**
 * Post a reply message into a forum thread (e.g. a #bug-report post) identified
 * by id or title substring, then disconnect. One-shot per invocation. With
 * `dryRun`, resolve the thread and print what would be sent without posting —
 * posting to Discord is outward-facing, so previewing first is the safe default.
 *
 * The returned promise settles only once the work is actually finished: it
 * resolves from inside the `finally`, after `client.destroy()`, not when
 * `client.login()` resolves. discord.js's `login()` resolves on the raw
 * gateway READY dispatch, which fires BEFORE the `clientReady` event this
 * function's work runs on — awaiting `login()` alone would return before the
 * reply has even started. A `login()` rejection (e.g. a bad token) rejects
 * this promise directly, since `clientReady` never fires in that case.
 */
export async function runReply(
  client: Client,
  token: string,
  guildId: string,
  threadQuery: string,
  message: string,
  dryRun: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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
        const channels = [...full.channels.cache.values()].filter(
          (c): c is TextChannel => c instanceof TextChannel,
        );
        // Forum threads first — that is the common case. But conversations also
        // happen in plain text channels (#general), and a follow-up owes the
        // reporter an answer wherever they raised it, so fall back to matching a
        // text channel by name before giving up. Exact matches (by id or exact
        // name) always win over the thread lookup's fuzzy substring behaviour —
        // see resolveReplyTarget.
        const target: ThreadChannel | TextChannel | null = resolveReplyTarget(
          threads,
          channels,
          threadQuery,
        );

        if (!target) {
          process.exitCode = 1;
          return;
        }

        if (dryRun) {
          log(`[dry-run] would post to "${target.name}" (id ${target.id}):`);
          log(`[dry-run] ${message}`);
          return;
        }

        const sent = await target.send(message);
        log(`Posted reply to "${target.name}" (id ${target.id}): ${sent.url}`);
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
