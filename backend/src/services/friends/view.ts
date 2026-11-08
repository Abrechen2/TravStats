/**
 * The friends of one user as the page reads them (spec 2026-11-08 §11.4): local connections,
 * remote connections, and — for a server that predates connections — a leaderboard pairing with
 * the comparison alone. One list, one shape; requests (someone asked the caller) are the same
 * shape with `state: "pending_in"`.
 */
import { prisma } from "../../db";
import type { LeaderboardConsent, LeaderboardRemote, LocalConnection } from "../../prisma";
import { connectionSwitchesSchema, type ConnectionSwitches } from "../../schemas/tripSharePeer";
import type { LeaderboardScope } from "../../schemas/comparison";
import { PERSON_SELECT, toPerson } from "../sharing/people";
import { connectionView } from "../sharing/federation/connections/view";
import { ALL_OFF } from "../sharing/federation/connections/switches";
import { tripFederationAvailability } from "../sharing/federation/availability";
import { fingerprintOfRaw, rawPublicKey } from "../federation/rawKey";
import { listOwnAdmissions } from "../comparison/inviteLinks";
import { readScope } from "../comparison/consents";
import { otherOf, sidesOf } from "./localConnections";
import type { z } from "../../schemas/zod";
import type { friendSchema, friendsListSchema } from "../../schemas/friends";

export type Friend = z.infer<typeof friendSchema>;
export type FriendsList = z.infer<typeof friendsListSchema>;

const switchesOrNull = (raw: unknown): ConnectionSwitches | null => {
  const parsed = connectionSwitchesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};
const iso = (d: Date | null) => d?.toISOString() ?? null;

const scopeOf = (
  c: Pick<LeaderboardConsent, "id" | "scope"> | undefined
): LeaderboardScope | null => (c ? readScope(c.scope, c.id) : null);

export function localFriend(
  row: LocalConnection,
  me: string,
  person: ReturnType<typeof toPerson>,
  consent: Pick<LeaderboardConsent, "id" | "scope"> | undefined
): Friend {
  const { mine, theirs } = sidesOf(row, me);
  const state =
    row.state === "pending"
      ? row.requestedBy === me
        ? "pending_out"
        : "pending_in"
      : (row.state as Friend["state"]);
  return {
    key: `local:${person.id}`,
    kind: "local",
    connectionId: null,
    username: person.username,
    displayName: person.displayName,
    origin: null,
    state,
    comparisonOnly: false,
    olderServer: false,
    switches: state === "pending_in" ? theirs : null,
    proposed: null,
    mine: state === "pending_in" ? ALL_OFF : mine,
    theirs: state === "pending_out" ? ALL_OFF : theirs,
    scope: scopeOf(consent),
    viaLink: false,
    fingerprint: null,
    requestedAt: iso(row.requestedAt),
    confirmedAt: iso(row.confirmedAt),
  };
}

type Remote = LeaderboardRemote & { consents: LeaderboardConsent[] };
type Connection = Awaited<ReturnType<typeof prisma.remoteShareAccount.findMany>>[number];

const isQuestion = (c: Pick<LeaderboardConsent, "status" | "decidedAt"> | undefined) =>
  c?.status === "pending" && c.decidedAt === null;

export function remoteFriend(
  row: Connection,
  lb: Remote | undefined,
  fingerprints: Map<string, string>
): Friend {
  const view = connectionView(row);
  const consent = lb?.consents[0];
  const viaLink = row.state === "pending_in" && isQuestion(consent);
  return {
    key: `remote:${lb?.id ?? row.id}`,
    kind: "remote",
    connectionId: row.id,
    username: row.username,
    displayName: row.displayName,
    origin: row.origin,
    state: view.state,
    comparisonOnly: false,
    olderServer: false,
    switches: view.state === "pending_in" ? view.theirs : null,
    proposed: viaLink ? switchesOrNull(lb?.inviteSwitches) : null,
    mine: view.mine,
    theirs: view.theirs,
    scope: scopeOf(consent),
    viaLink,
    fingerprint: viaLink ? (fingerprints.get(row.origin) ?? null) : null,
    requestedAt: view.requestedAt,
    confirmedAt: view.confirmedAt,
  };
}

/** A leaderboard pairing with no connection behind it: only the comparison exists. */
export function comparisonOnlyFriend(lb: Remote): Friend | null {
  const consent = lb.consents[0];
  const question = isQuestion(consent);
  const offer = consent?.status === "pending" && consent.decidedAt !== null;
  const shares = consent?.status === "accepted";
  if (!question && !offer && !shares) return null;
  const theirsOn = lb.theirStatus === "ok" || lb.theirStatus === "yearNotShared";
  const leaderboardOnly = (on: boolean): ConnectionSwitches => ({ ...ALL_OFF, leaderboard: on });
  return {
    key: `remote:${lb.id}`,
    kind: "remote",
    connectionId: null,
    username: lb.username,
    displayName: lb.displayName,
    origin: lb.origin,
    state: question ? "pending_in" : offer ? "pending_out" : "active",
    comparisonOnly: true,
    olderServer: true,
    switches: question ? leaderboardOnly(theirsOn) : null,
    proposed: null,
    mine: leaderboardOnly(shares),
    theirs: leaderboardOnly(theirsOn),
    scope: scopeOf(consent),
    viaLink: false,
    fingerprint: null,
    requestedAt: iso(consent?.createdAt ?? lb.createdAt),
    confirmedAt: shares ? iso(consent?.decidedAt ?? null) : null,
  };
}

const LISTED_LOCAL = ["pending", "active"];
const LISTED_REMOTE = ["pending_out", "pending_in", "active", "reconfirm"];

async function peerFingerprints(origins: string[]): Promise<Map<string, string>> {
  const peers = origins.length
    ? await prisma.comparisonPeer.findMany({ where: { origin: { in: origins } } })
    : [];
  const out = new Map<string, string>();
  for (const p of peers) {
    const raw = rawPublicKey(p.publicKey);
    const fp = raw ? fingerprintOfRaw(raw) : null;
    if (fp) out.set(p.origin, fp);
  }
  return out;
}

export async function listFriends(userId: string): Promise<FriendsList> {
  const [locals, connections, remotes, consents, federation, admissions] = await Promise.all([
    prisma.localConnection.findMany({
      where: { state: { in: LISTED_LOCAL }, OR: [{ userLowId: userId }, { userHighId: userId }] },
      orderBy: { requestedAt: "asc" },
    }),
    prisma.remoteShareAccount.findMany({
      where: { userId, state: { in: LISTED_REMOTE } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.leaderboardRemote.findMany({
      where: { userId },
      include: { consents: { where: { ownerId: userId } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.leaderboardConsent.findMany({
      where: { ownerId: userId, viewerId: { not: null } },
      select: { id: true, scope: true, viewerId: true },
    }),
    tripFederationAvailability(),
    listOwnAdmissions(userId),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: locals.map((r) => otherOf(r, userId)) }, isActive: true },
    select: PERSON_SELECT,
  });
  const byUser = new Map(users.map((u) => [u.id, toPerson(u)]));
  const consentOf = new Map(consents.map((c) => [c.viewerId as string, c]));
  const lbById = new Map(remotes.map((r) => [r.id, r]));
  const fingerprints = await peerFingerprints([...new Set(connections.map((c) => c.origin))]);

  const all: Friend[] = [];
  for (const row of locals) {
    const person = byUser.get(otherOf(row, userId));
    if (person) all.push(localFriend(row, userId, person, consentOf.get(person.id)));
  }
  const linked = new Set<string>();
  for (const row of connections) {
    const lb = row.leaderboardRemoteId ? lbById.get(row.leaderboardRemoteId) : undefined;
    if (lb) linked.add(lb.id);
    all.push(remoteFriend(row, lb, fingerprints));
  }
  for (const lb of remotes) {
    if (linked.has(lb.id)) continue;
    // A pairing whose connection ended is not a comparison-only friend: a connection row owns it.
    const owned = await prisma.remoteShareAccount.count({ where: { leaderboardRemoteId: lb.id } });
    if (owned > 0) continue;
    const friend = comparisonOnlyFriend(lb);
    if (friend) all.push(friend);
  }
  return {
    friends: all.filter((f) => f.state !== "pending_in"),
    requests: all.filter((f) => f.state === "pending_in"),
    admissions: admissions
      .filter((a) => a.status === "pending" || a.status === "sent")
      .map((a) => ({ ...a, status: a.status as "pending" | "sent" })),
    federationAvailable: federation.available,
  };
}
