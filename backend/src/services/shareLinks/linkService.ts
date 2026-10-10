import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import {
  publicViewSchema,
  SHARE_LINK_MAX_ACTIVE,
  SHARE_LINK_MAX_DAYS,
  type OwnerShareLink,
  type PublicView,
  type ShareLinkField,
  type ShareLinkKind,
  type ShareLinkSelection,
} from "../../schemas/shareLinks";
import { now } from "../../shared/time/clock";
import { getInstanceSettings } from "../instanceSettingsService";
import logger from "../../utils/logger";
import { buildFlightView, flightAutoExpiry, loadOwnedFlightTimes } from "./flightView";
import { photoSnapshot, sharedPhotoBytes } from "./photoProxy";
import {
  generateShareToken,
  looksLikeShareToken,
  shareTokenHash,
  shareTokenMatches,
} from "./token";
import { buildTripView, loadOwnedTrip } from "./tripView";
import { buildWrappedView } from "./wrappedView";

/**
 * Public share links (forgejo#281) — design
 * `docs/superpowers/specs/2026-10-10-share-links-design.md`.
 *
 * One rule runs through every function here: the owner side may say "not
 * found" for a target that is not theirs, and the public side says "not
 * found" for EVERYTHING that is not a live link — malformed, unknown,
 * expired, revoked, switched off, owner or target gone. One answer, so the
 * public endpoint is no oracle.
 */

export const notFound = () => new AppError("Not found", 404, "SHARE_LINK_NOT_FOUND");

export async function shareLinksEnabled(): Promise<boolean> {
  return (await getInstanceSettings()).shareLinksEnabled;
}

async function ownerFirstName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true } });
  return user?.firstName?.trim() || null;
}

interface Target {
  kind: ShareLinkKind;
  flightId: string | null;
  tripId: string | null;
  year: number | null;
}

function targetOf(selection: Pick<ShareLinkSelection, "kind" | "targetId">): Target {
  return {
    kind: selection.kind,
    flightId: selection.kind === "flight" ? selection.targetId : null,
    tripId: selection.kind === "trip" ? selection.targetId : null,
    year: selection.kind === "wrapped" ? Number(selection.targetId) : null,
  };
}

/**
 * The public view of a target, built from `fields` only, and the instant a
 * flight link ends by itself. Null: the target is not the user's, or has
 * nothing to show. The output is parsed through the strict view schema
 * before it is returned, so no builder can add a key nobody reviewed.
 */
async function buildView(
  userId: string,
  target: Target,
  fields: readonly string[],
  photoIds: readonly string[]
): Promise<{ view: PublicView; autoExpiry: Date | null } | null> {
  const owner = fields.includes("owner") ? await ownerFirstName(userId) : null;
  let built: { view: PublicView; autoExpiry: Date | null } | null = null;
  if (target.kind === "flight" && target.flightId) {
    const loaded = await loadOwnedFlightTimes(userId, target.flightId);
    if (!loaded) return null;
    const set = new Set(fields) as Set<ShareLinkField<"flight">>;
    built = {
      view: { kind: "flight", flight: await buildFlightView(target.flightId, loaded, set, owner) },
      autoExpiry: flightAutoExpiry(loaded.times),
    };
  } else if (target.kind === "trip" && target.tripId) {
    const trip = await loadOwnedTrip(userId, target.tripId);
    if (!trip) return null;
    const set = new Set(fields) as Set<ShareLinkField<"trip">>;
    built = {
      view: { kind: "trip", trip: await buildTripView(userId, trip, set, owner, photoIds) },
      autoExpiry: null,
    };
  } else if (target.kind === "wrapped" && target.year !== null) {
    const set = new Set(fields) as Set<ShareLinkField<"wrapped">>;
    const wrapped = await buildWrappedView(userId, target.year, set, owner);
    if (!wrapped) return null;
    built = { view: { kind: "wrapped", wrapped }, autoExpiry: null };
  }
  if (!built) return null;
  return { view: publicViewSchema.parse(built.view), autoExpiry: built.autoExpiry };
}

const earlier = (a: Date, b: Date | null): Date => (b && b < a ? b : a);

/** What the public would see for this selection — the same builder the link uses. */
export async function previewShareLink(
  userId: string,
  selection: ShareLinkSelection
): Promise<PublicView> {
  const target = targetOf(selection);
  const photos = target.tripId ? await photoSnapshot(target.tripId) : [];
  const built = await buildView(userId, target, selection.fields, photos);
  if (!built) throw notFound();
  return built.view;
}

export async function createShareLink(
  userId: string,
  selection: ShareLinkSelection,
  expiresAt: Date,
  publicBaseUrl: string
): Promise<{
  id: string;
  url: string;
  token: string;
  expiresAt: string;
  effectiveExpiresAt: string;
}> {
  if (!(await shareLinksEnabled())) {
    throw new AppError(
      "Public share links are switched off on this instance",
      409,
      "SHARE_LINKS_DISABLED"
    );
  }
  const at = now();
  const latest = new Date(at.getTime() + SHARE_LINK_MAX_DAYS * 86_400_000);
  if (expiresAt <= at || expiresAt > latest) {
    throw new AppError(
      `The expiry must lie between now and ${SHARE_LINK_MAX_DAYS} days ahead`,
      400,
      "SHARE_LINK_EXPIRY_INVALID",
      "expiresAt"
    );
  }
  const target = targetOf(selection);
  const photoIds =
    target.tripId && selection.fields.includes("photos") ? await photoSnapshot(target.tripId) : [];
  const built = await buildView(userId, target, selection.fields, photoIds);
  if (!built) throw notFound();
  if (built.autoExpiry && built.autoExpiry <= at) {
    throw new AppError("This flight has already landed", 409, "SHARE_LINK_FLIGHT_LANDED");
  }
  const active = await prisma.publicShareLink.count({ where: { userId, expiresAt: { gt: at } } });
  if (active >= SHARE_LINK_MAX_ACTIVE) {
    throw new AppError(
      `At most ${SHARE_LINK_MAX_ACTIVE} links can be active at once`,
      409,
      "SHARE_LINK_LIMIT"
    );
  }

  const { token, tokenHash } = generateShareToken();
  const row = await prisma.publicShareLink.create({
    data: { userId, ...target, fields: selection.fields, photoIds, tokenHash, expiresAt },
    select: { id: true },
  });
  logger.info({ operation: "share_link_created", userId, linkId: row.id, kind: target.kind });
  return {
    id: row.id,
    // The token rides in the FRAGMENT: never sent to a server, so it reaches
    // no access log, no proxy, no Referer (design §2, T1–T3).
    url: `${publicBaseUrl}/share#${token}`,
    token,
    expiresAt: expiresAt.toISOString(),
    effectiveExpiresAt: earlier(expiresAt, built.autoExpiry).toISOString(),
  };
}

type LinkRow = Awaited<ReturnType<typeof prisma.publicShareLink.findMany>>[number];

const targetIdOf = (row: Pick<LinkRow, "flightId" | "tripId" | "year">): string =>
  row.flightId ?? row.tripId ?? String(row.year);

/** A flight link's end as of now, from the flight's current times. */
async function effectiveExpiry(row: LinkRow): Promise<Date> {
  if (!row.flightId) return row.expiresAt;
  const loaded = await loadOwnedFlightTimes(row.userId, row.flightId);
  return earlier(row.expiresAt, loaded ? flightAutoExpiry(loaded.times) : null);
}

/** The caller's live links. Lapsed ones are deleted on the way: nothing reads them again. */
export async function listShareLinks(userId: string): Promise<OwnerShareLink[]> {
  const at = now();
  await prisma.publicShareLink.deleteMany({ where: { userId, expiresAt: { lte: at } } });
  const rows = await prisma.publicShareLink.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const out: OwnerShareLink[] = [];
  for (const row of rows) {
    const effective = await effectiveExpiry(row);
    if (effective <= at) continue;
    out.push({
      id: row.id,
      kind: row.kind as ShareLinkKind,
      targetId: targetIdOf(row),
      fields: row.fields,
      expiresAt: row.expiresAt.toISOString(),
      effectiveExpiresAt: effective.toISOString(),
      createdAt: row.createdAt.toISOString(),
      viewCount: row.viewCount,
      lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    });
  }
  return out;
}

export async function revokeShareLink(userId: string, id: string): Promise<void> {
  const { count } = await prisma.publicShareLink.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound();
  logger.info({ operation: "share_link_revoked", userId, linkId: id });
}

/** The live link a token names, or null for every way it can fail to be one. */
async function liveLink(token: unknown): Promise<LinkRow | null> {
  if (!(await shareLinksEnabled())) return null;
  if (!looksLikeShareToken(token)) return null;
  const row = await prisma.publicShareLink.findUnique({
    where: { tokenHash: shareTokenHash(token) },
  });
  if (!row || !shareTokenMatches(token, row.tokenHash)) return null;
  const owner = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { isActive: true },
  });
  if (!owner?.isActive) return null;
  if ((await effectiveExpiry(row)) <= now()) return null;
  return row;
}

const targetOfRow = (row: LinkRow): Target => ({
  kind: row.kind as ShareLinkKind,
  flightId: row.flightId,
  tripId: row.tripId,
  year: row.year,
});

export async function resolvePublicView(
  token: unknown
): Promise<{ expiresAt: string; view: PublicView } | null> {
  const row = await liveLink(token);
  if (!row) return null;
  const built = await buildView(row.userId, targetOfRow(row), row.fields, row.photoIds);
  if (!built) return null;
  // A count and a time, for the owner to notice a link travelling further than
  // meant — never who looked.
  await prisma.publicShareLink.update({
    where: { id: row.id },
    data: { viewCount: { increment: 1 }, lastViewedAt: now() },
  });
  return {
    expiresAt: earlier(row.expiresAt, built.autoExpiry).toISOString(),
    view: built.view,
  };
}

export async function resolvePublicPhoto(
  token: unknown,
  index: number
): Promise<{ bytes: Buffer; type: string } | null> {
  const row = await liveLink(token);
  if (!row || !row.tripId || !row.fields.includes("photos")) return null;
  const trip = await loadOwnedTrip(row.userId, row.tripId);
  if (!trip) return null;
  return sharedPhotoBytes(row.tripId, row.photoIds, index);
}
