/**
 * Achievements over a connection (spec 2026-11-02 §2, `share_achievements`): with the switch on, the
 * connected person sees this account's earned badges and the totals the own achievements page shows
 * — the same visibility rule (a hidden domain's badge is neither listed nor counted), nothing but
 * the badge definitions and the date each was first earned. No record, no progress figure.
 *
 * Serving fails closed and answers one way: an unknown connection, one that is not `active`, a
 * switch that is off and an inactive owner all read `notShared`.
 */
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { exchange } from "../../federation/security";
import {
  achievementsReplySchema,
  type AchievementsRead,
  type AchievementsReply,
  type RemoteBadge,
} from "../../../schemas/tripSharePeer";
import { achievements as catalogueDefinitions } from "../../../data/achievements";
import { isAchievementHeld } from "../../../utils/achievementHeld";
import { resolveRank } from "../../../utils/achievementRank";
import { loadAchievementVisibility } from "../../achievementVisibility";
import { requireTripFederation } from "./access";
import { mayServeAchievements } from "./connections/switches";
import { remoteShareError } from "./errors";
import { peerSupports } from "./peerFeatures";
import {
  LOCAL_ERROR,
  kindOf,
  requireAdmitted,
  requireTripSharePeer,
  unreachable,
} from "./peerCheck";
import { ACHIEVEMENTS_TRANSPORT, messageHeader } from "./transport";

const TEST_ACHIEVEMENT_PREFIX = "TEST_";
const NOT_SHARED: AchievementsReply = { kind: "achievements-reply", status: "notShared" };

type OkReply = Extract<AchievementsReply, { status: "ok" }>;
/** What the member-facing API answers: the wire reply without its envelope fields. */
export type RemoteAchievements = Pick<OkReply, "summary" | "earned">;

/** The badges a user holds and may show, with the totals — what `GET /achievements` lists and sums. */
export async function buildEarnedBadges(userId: string): Promise<OkReply> {
  const live = new Set(catalogueDefinitions.map((a) => a.code));
  const visible = await loadAchievementVisibility(userId);
  const rows = await prisma.userAchievement.findMany({
    where: { userId, achievement: { code: { not: { startsWith: TEST_ACHIEVEMENT_PREFIX } } } },
    include: { achievement: true },
    orderBy: [{ achievement: { category: "asc" } }, { achievement: { requirement: "asc" } }],
  });
  const held = rows.filter(
    (ua) =>
      visible(ua.achievement.domain, ua.achievement.code) &&
      isAchievementHeld(ua, ua.achievement.requirement)
  );
  const totalPoints = held.reduce((sum, ua) => sum + ua.achievement.points, 0);
  const definitions = await prisma.achievement.findMany({
    where: { code: { not: { startsWith: TEST_ACHIEVEMENT_PREFIX } } },
    select: { code: true, domain: true },
  });
  const totalAchievements = definitions.filter(
    (a) => live.has(a.code) && visible(a.domain, a.code)
  ).length;
  const earned: RemoteBadge[] = held.map((ua) => ({
    code: ua.achievement.code,
    name: ua.achievement.name,
    description: ua.achievement.description,
    category: ua.achievement.category,
    domain: ua.achievement.domain,
    tier: ua.achievement.tier,
    icon: ua.achievement.icon,
    points: ua.achievement.points,
    unlockedAt: ua.unlockedAt ? ua.unlockedAt.toISOString() : null,
  }));
  return {
    kind: "achievements-reply",
    status: "ok",
    summary: {
      totalAchievements,
      unlockedAchievements: held.filter((ua) => live.has(ua.achievement.code)).length,
      totalPoints,
      rank: resolveRank(totalPoints).rank,
    },
    earned,
  };
}

export async function serveAchievementsRead(
  origin: string,
  body: AchievementsRead
): Promise<AchievementsReply> {
  const pairing = await prisma.remoteShareAccount.findFirst({
    where: { origin, channel: body.from, localChannel: body.to },
    include: { user: { select: { isActive: true } } },
  });
  if (!pairing?.user.isActive || !mayServeAchievements(pairing)) return NOT_SHARED;
  return buildEarnedBadges(pairing.userId);
}

/** The caller reads the achievements a connected person shows them. */
export async function readRemoteAchievements(
  userId: string,
  connectionId: string
): Promise<RemoteAchievements> {
  await requireTripFederation(userId);
  const pairing = await prisma.remoteShareAccount.findFirst({
    where: { id: connectionId, userId },
  });
  if (!pairing)
    throw remoteShareError("SHARE_REMOTE_PERSON_NOT_FOUND", 404, "No such person", { userId });
  if (pairing.state !== "active")
    throw remoteShareError(
      "SHARE_REMOTE_CONNECTION_REQUIRED",
      409,
      "Connect with that person first",
      { userId, origin: pairing.origin },
      { origin: pairing.origin }
    );
  await requireAdmitted(userId, pairing.origin);
  await requireTripSharePeer(userId, pairing.origin);
  if (!(await peerSupports(pairing.origin, "achievements").catch(() => false)))
    throw remoteShareError(
      "SHARE_REMOTE_PEER_OUTDATED",
      409,
      "That server needs an update",
      { userId, origin: pairing.origin },
      { origin: pairing.origin }
    );
  let reply: AchievementsReply;
  try {
    reply = achievementsReplySchema.parse(
      await exchange(
        pairing.origin,
        {
          kind: "achievements-read",
          ...messageHeader(),
          from: pairing.localChannel,
          to: pairing.channel,
        },
        ACHIEVEMENTS_TRANSPORT
      )
    );
  } catch (error) {
    const kind = kindOf(error);
    if (kind !== LOCAL_ERROR)
      logger.warn(
        { operation: "achievements_read_failed", userId, kind },
        "Reading a connected person's achievements failed"
      );
    throw kind === LOCAL_ERROR ? error : unreachable(userId, pairing.origin, kind);
  }
  if (reply.status === "notShared")
    throw remoteShareError(
      "SHARE_REMOTE_ACHIEVEMENTS_NOT_SHARED",
      403,
      "That person does not show you their achievements",
      { userId, origin: pairing.origin },
      { origin: pairing.origin }
    );
  return { summary: reply.summary, earned: reply.earned };
}
