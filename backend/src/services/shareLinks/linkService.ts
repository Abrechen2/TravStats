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
import { photoSnapshot, sharedPhotoBytes, type PhotoOmissions } from "./photoProxy";
import {
  generateShareToken,
  looksLikeShareToken,
  shareTokenHash,
  shareTokenMatches,
} from "./token";
import { itineraryAutoExpiry } from "./itineraryNow";
import { buildTripView, loadOwnedTrip } from "./tripView";
import { withTripTimes } from "../trips/timesDto";
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
      autoExpiry: set.has("itinerary") ? tripAutoExpiry(trip) : null,
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

/** An itinerary link ends by itself a day after the trip's last local day (forgejo#302). */
function tripAutoExpiry(trip: Parameters<typeof withTripTimes>[0]): Date | null {
  return itineraryAutoExpiry(withTripTimes(trip).times.end);
}

/**
 * The photos a new trip link would carry — only for a trip of the caller's
 * own (the snapshot reads files) and only when photos were chosen. `omitted`
 * tells the owner what was left out and why; the public never sees it.
 */
async function snapshotFor(
  userId: string,
  target: Target,
  fields: readonly string[]
): Promise<{ ids: string[]; omitted: PhotoOmissions | null }> {
  if (!target.tripId || !fields.includes("photos")) return { ids: [], omitted: null };
  if (!(await loadOwnedTrip(userId, target.tripId))) throw notFound();
  return photoSnapshot(target.tripId);
}

/** What the public would see for this selection — the same builder the link uses. */
export async function previewShareLink(
  userId: string,
  selection: ShareLinkSelection
): Promise<{ view: PublicView; photosOmitted: PhotoOmissions | null }> {
  const target = targetOf(selection);
  const photos = await snapshotFor(userId, target, selection.fields);
  const built = await buildView(userId, target, selection.fields, photos.ids);
  if (!built) throw notFound();
  return { view: built.view, photosOmitted: photos.omitted };
}

export async function createShareLink(
  userId: string,
  selection: ShareLinkSelection,
  expiry: Date | number,
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
  // Relative lifetimes use this same server instant for calculation and validation.
  const expiresAt =
    typeof expiry === "number" ? new Date(at.getTime() + expiry * 86_400_000) : expiry;
  const latest = new Date(at.getTime() + SHARE_LINK_MAX_DAYS * 86_400_000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= at || expiresAt > latest) {
    throw new AppError(
      `The expiry must lie between now and ${SHARE_LINK_MAX_DAYS} days ahead`,
      400,
      "SHARE_LINK_EXPIRY_INVALID",
      "expiresAt"
    );
  }
  const target = targetOf(selection);
  const { ids: photoIds } = await snapshotFor(userId, target, selection.fields);
  const built = await buildView(userId, target, selection.fields, photoIds);
  if (!built) throw notFound();
  if (built.autoExpiry && built.autoExpiry <= at) {
    throw target.kind === "trip"
      ? new AppError("This trip has already ended", 409, "SHARE_LINK_TRIP_ENDED")
      : new AppError("This flight has already landed", 409, "SHARE_LINK_FLIGHT_LANDED");
  }
  // The same settled set the list shows: a link the owner cannot see must not
  // hold one of their slots.
  const active = (await settleLinks(userId, at)).length;
  if (active >= SHARE_LINK_MAX_ACTIVE) {
    throw new AppError(
      `At most ${SHARE_LINK_MAX_ACTIVE} links can be active at once`,
      409,
      "SHARE_LINK_LIMIT"
    );
  }

  const { token, tokenHash } = generateShareToken();
  const effectiveExpiresAt = earlier(expiresAt, built.autoExpiry);
  const row = await prisma.publicShareLink.create({
    data: {
      userId,
      ...target,
      fields: selection.fields,
      photoIds,
      tokenHash,
      expiresAt,
      effectiveExpiresAt,
    },
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
    effectiveExpiresAt: effectiveExpiresAt.toISOString(),
  };
}

type LinkRow = Awaited<ReturnType<typeof prisma.publicShareLink.findMany>>[number];

const targetIdOf = (row: Pick<LinkRow, "flightId" | "tripId" | "year">): string =>
  row.flightId ?? row.tripId ?? String(row.year);

/** The end a link's target sets by itself today: a flight's landing, an itinerary's trip end. */
async function targetAutoExpiry(row: LinkRow): Promise<Date | null> {
  if (row.flightId) {
    const loaded = await loadOwnedFlightTimes(row.userId, row.flightId);
    return loaded ? flightAutoExpiry(loaded.times) : null;
  }
  if (row.tripId && row.fields.includes("itinerary")) {
    const trip = await loadOwnedTrip(row.userId, row.tripId);
    return trip ? tripAutoExpiry(trip) : null;
  }
  return null;
}

/**
 * A link's end as of now: the stored end, LOWERED (and stored) when its
 * flight now lands earlier or its itinerary's trip now ends earlier. Never
 * raised — recomputing the end from the flight's current times brought an
 * ended link back to life when the flight was later moved to another day.
 */
async function settledExpiry(row: LinkRow): Promise<Date> {
  if (!row.flightId && !row.fields.includes("itinerary")) return row.effectiveExpiresAt;
  const effective = earlier(row.effectiveExpiresAt, await targetAutoExpiry(row));
  // Lowered in the database, not from the row read above: a settlement that
  // finished in between may already have stored an even earlier end, and an
  // unconditional write would raise it again. The answer — on every path,
  // including "nothing to lower" — is what is stored, since the row read
  // above may already be stale and access is decided on this value.
  if (effective < row.effectiveExpiresAt) {
    await prisma.publicShareLink.updateMany({
      where: { id: row.id, effectiveExpiresAt: { gt: effective } },
      data: { effectiveExpiresAt: effective },
    });
  }
  const persisted = await prisma.publicShareLink.findUnique({
    where: { id: row.id },
    select: { effectiveExpiresAt: true },
  });
  // Revoked meanwhile: a link that no longer exists has ended.
  return persisted?.effectiveExpiresAt ?? new Date(0);
}

/**
 * The owner's live links, newest first. Ended ones are deleted on the way, so
 * the active count, the list and the public side all read one set — a landed
 * flight's link used to hold a slot of the limit while the list hid it and
 * nothing could revoke it.
 */
async function settleLinks(userId: string, at: Date): Promise<LinkRow[]> {
  const rows = await prisma.publicShareLink.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const live: LinkRow[] = [];
  const ended: string[] = [];
  for (const row of rows) {
    const effectiveExpiresAt = await settledExpiry(row);
    if (effectiveExpiresAt <= at) ended.push(row.id);
    else live.push({ ...row, effectiveExpiresAt });
  }
  if (ended.length > 0) {
    await prisma.publicShareLink.deleteMany({ where: { id: { in: ended }, userId } });
  }
  return live;
}

/** The caller's live links. */
export async function listShareLinks(userId: string): Promise<OwnerShareLink[]> {
  const rows = await settleLinks(userId, now());
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as ShareLinkKind,
    targetId: targetIdOf(row),
    fields: row.fields,
    expiresAt: row.expiresAt.toISOString(),
    effectiveExpiresAt: row.effectiveExpiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    viewCount: row.viewCount,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
  }));
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
  const effectiveExpiresAt = await settledExpiry(row);
  if (effectiveExpiresAt <= now()) {
    await prisma.publicShareLink.deleteMany({ where: { id: row.id } });
    return null;
  }
  return { ...row, effectiveExpiresAt };
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
    expiresAt: earlier(row.effectiveExpiresAt, built.autoExpiry).toISOString(),
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
