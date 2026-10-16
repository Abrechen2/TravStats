/**
 * The leaderboard for one viewer (spec §6). Same-instance friends are read here, server-side,
 * under the consent each gave — no keys, no decryption. Remote friends are pulled in parallel.
 * A friend whose consent is not accepted, or whose account is deactivated, is not a row at all.
 *
 * One friend never costs the page: a stored scope that does not parse is that row's
 * "notShared", a loader that throws is that row's "unreachable", and a remote server that
 * fails or does not answer in time is that row's "unreachable" — the row keeps its
 * `remote:<id>` key, so a friendship ended on the other side can still be ended here.
 */
import { prisma } from "../../db";
import type { LeaderboardConsent, LeaderboardRemote } from "../../prisma";
import logger from "../../utils/logger";
import { METRIC_GROUPS } from "../../shared/comparisonMetrics";
import { PERSON_SELECT } from "../sharing/people";
import { loadVisibleDomains } from "../domainVisibility";
import {
  leaderboardResponseSchema,
  type LeaderboardResponse,
  type LeaderboardRow,
  type Person,
} from "../../schemas/comparison";
import { buildLeaderboardSnapshot } from "./aggregates";
import { boardMemberKeys } from "./boards";
import { localKey, localPerson, readScope, remoteKey, remotePerson } from "./consents";
import { pullRemote, type RemoteResult } from "./remote";

export const LOCAL_ROW_CAP = 50;
export const REMOTE_ROW_CAP = 20;
/**
 * The longest one remote friend may hold the page. pullRemote can make two exchanges (a ping,
 * then the aggregate), each bounded at 10 s by the transport; a page waiting 20 s for one slow
 * server is a page nobody waits for.
 */
export const REMOTE_PULL_DEADLINE_MS = 12_000;

/**
 * How many friends' totals are built at once. Up to LOCAL_ROW_CAP of them, one by one, was a
 * page load of fifty sequential aggregate passes; all at once would take fifty pooled
 * connections from everyone else.
 */
const SNAPSHOT_CONCURRENCY = 4;

type Pull = (remote: LeaderboardRemote, year: number | null) => Promise<RemoteResult>;

const LOCAL_PREFIX = localKey("");
const REMOTE_PREFIX = remoteKey("");

/**
 * The board as a `where` on each list, so the row caps bound the board's members and not the
 * oldest friends overall — a member past the 50 oldest consents must still appear.
 */
function boardWhere(members: Set<string> | null) {
  if (!members) return { local: {}, remote: {} };
  const ids = (prefix: string) =>
    [...members].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  return {
    local: { ownerId: { in: ids(LOCAL_PREFIX) } },
    remote: { id: { in: ids(REMOTE_PREFIX) } },
  };
}

/**
 * Maps with at most `limit` calls in flight and keeps the input order in the result. The mapper
 * must not throw — each row turns its own failure into a status (see localRow).
 */
async function mapInOrder<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await map(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function localRow(
  consent: LeaderboardConsent,
  person: Person,
  year: number | null
): Promise<LeaderboardRow> {
  const scope = readScope(consent.scope, consent.id);
  if (!scope) return { person, status: "notShared", snapshot: null, sharedYear: null };
  if (scope.year !== null && scope.year !== year)
    return { person, status: "yearNotShared", snapshot: null, sharedYear: scope.year };
  try {
    const snapshot = await buildLeaderboardSnapshot(consent.ownerId, scope, year);
    return { person, status: "ok", snapshot, sharedYear: scope.year };
  } catch (error) {
    // One friend's failing loader must not blank everyone's board; it is logged, not hidden.
    logger.error(
      { operation: "comparison_snapshot_failed", ownerId: consent.ownerId, err: error },
      "Totals not built"
    );
    return { person, status: "unreachable", snapshot: null, sharedYear: scope.year };
  }
}

/** One remote pull, bounded in time; a throw or a timeout is that friend's "unreachable". */
async function pullWithin(
  pull: Pull,
  remote: LeaderboardRemote,
  year: number | null,
  deadlineMs: number
): Promise<RemoteResult> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<RemoteResult>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(
        { operation: "comparison_pull_timeout", remoteId: remote.id, origin: remote.origin },
        "A remote friend's server did not answer in time"
      );
      resolve({ status: "unreachable" });
    }, deadlineMs);
  });
  try {
    return await Promise.race([pull(remote, year), deadline]);
  } catch (error) {
    logger.warn(
      {
        operation: "comparison_pull_failed",
        remoteId: remote.id,
        origin: remote.origin,
        err: error,
      },
      "A remote friend's totals could not be read"
    );
    return { status: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

const remoteRow = (remote: LeaderboardRemote, result: RemoteResult): LeaderboardRow =>
  result.status === "ok"
    ? { person: remotePerson(remote), status: "ok", snapshot: result.snapshot, sharedYear: null }
    : {
        person: remotePerson(remote),
        status: result.status,
        snapshot: null,
        sharedYear: result.sharedYear ?? null,
      };

export async function readLeaderboard(
  viewerId: string,
  query: { year: number | null; boardId?: string },
  pull: Pull = pullRemote,
  pullDeadlineMs: number = REMOTE_PULL_DEADLINE_MS
): Promise<LeaderboardResponse> {
  const { year } = query;
  const where = boardWhere(query.boardId ? await boardMemberKeys(viewerId, query.boardId) : null);

  // Remote pulls start first, so the network waits overlap the local reads below. None of this
  // runs inside a transaction.
  const remotes = await prisma.leaderboardRemote.findMany({
    where: { userId: viewerId, ...where.remote },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: REMOTE_ROW_CAP,
  });
  const pulled = Promise.all(remotes.map((r) => pullWithin(pull, r, year, pullDeadlineMs)));

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: viewerId },
    select: PERSON_SELECT,
  });
  const visible = await loadVisibleDomains(viewerId);
  const rows: LeaderboardRow[] = [
    {
      person: { ...localPerson(me), key: "self", kind: "self" },
      status: "ok",
      snapshot: await buildLeaderboardSnapshot(
        viewerId,
        { groups: [...METRIC_GROUPS], domains: visible, year: null },
        year
      ),
      sharedYear: null,
    },
  ];

  const consents = await prisma.leaderboardConsent.findMany({
    where: { viewerId, status: "accepted", owner: { isActive: true }, ...where.local },
    include: { owner: { select: PERSON_SELECT } },
    orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
    take: LOCAL_ROW_CAP,
  });
  rows.push(
    ...(await mapInOrder(consents, SNAPSHOT_CONCURRENCY, (consent) =>
      localRow(consent, localPerson(consent.owner), year)
    ))
  );

  const results = await pulled;
  rows.push(...remotes.map((remote, i) => remoteRow(remote, results[i])));
  return leaderboardResponseSchema.parse({ year, rows });
}
