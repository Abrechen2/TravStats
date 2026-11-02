/**
 * The member's side of a plan on another server (spec 2026-11-02 §4): the calls the member's own
 * web and Companion make against THIS server, which proxies them to the host under the signed
 * channel of the connection. This server keeps the invitation and a pointer (`remote_plan_memberships`)
 * and, for a few seconds, the last read - never the plan.
 *
 * Every call checks locally first (the person's own, active membership; the connection active with
 * plans on at both sides) and asks the host, which checks everything again. The refusals:
 * `REMOTE_PLAN_NOT_FOUND` (404, no such membership of this person), `REMOTE_PLAN_NOT_SHARED` (403,
 * the connection or a switch or the membership ended - the UI says "nicht mehr geteilt"; the
 * membership is marked ended so the plan leaves the list) and `REMOTE_PLAN_UNREACHABLE` (503, the
 * host does not answer; nothing is dropped, a client keeps its queue and retries).
 */
import { prisma } from "../../../../db";
import { AppError, type ApiErrorCode } from "../../../../middleware/errorHandler";
import type { Prisma } from "../../../../prisma";
import type { PlanPacket, PlanReply } from "../../../../schemas/tripSharePlans";
import { PLAN_DOCUMENT_MAX_BYTES } from "../../../travplan/planDocuments";
import { requireTripFederation } from "../access";
import { connectionAllowsPlans } from "../connections/switches";
import { announce } from "../connections/announcements";
import {
  PLAN_DOWNLOAD_TRANSPORT,
  PLAN_TRANSPORT,
  PLAN_UPLOAD_TRANSPORT,
  messageHeader,
} from "../transport";
import { PlanPeerUnreachable, callPeer } from "./peerCall";
import { READ_CACHE_MS } from "./shared";

type Account = Prisma.RemoteShareAccountGetPayload<object>;
type Membership = Prisma.RemotePlanMembershipGetPayload<object>;

const refuse = (code: ApiErrorCode, status: number, message: string, origin?: string) =>
  new AppError(message, status, code, undefined, origin ? { origin } : undefined);
const notFound = () => refuse("REMOTE_PLAN_NOT_FOUND", 404, "No such plan");
const notShared = (origin?: string) =>
  refuse("REMOTE_PLAN_NOT_SHARED", 403, "That plan is not shared with you any more", origin);
const unreachable = (origin: string) =>
  refuse("REMOTE_PLAN_UNREACHABLE", 503, "The server of that plan does not answer", origin);

export interface RemotePlanSummary {
  connectionId: string;
  origin: string;
  planId: string;
  tripId: string;
  title: string;
  ownerDisplayName: string;
  role: "editor";
  state: "invited" | "active";
}

const summaryOf = (m: Membership, origin: string): RemotePlanSummary => ({
  connectionId: m.connectionId,
  origin,
  planId: m.planId,
  tripId: m.tripId,
  title: m.title,
  ownerDisplayName: m.ownerDisplayName,
  role: "editor",
  state: m.state === "active" ? "active" : "invited",
});

export async function listRemotePlans(userId: string): Promise<RemotePlanSummary[]> {
  await requireTripFederation(userId);
  const rows = await prisma.remotePlanMembership.findMany({
    where: { userId, state: { in: ["invited", "active"] }, connection: { state: "active" } },
    include: { connection: { select: { origin: true } } },
    orderBy: [{ state: "asc" }, { invitedAt: "desc" }],
    take: 200,
  });
  return rows.map((r) => summaryOf(r, r.connection.origin));
}

// ---------------------------------------------------------------------------------- lookup

interface Context {
  account: Account;
  membership: Membership;
}

async function contextOf(
  userId: string,
  connectionId: string,
  planId: string,
  states: readonly string[]
): Promise<Context> {
  await requireTripFederation(userId);
  const membership = await prisma.remotePlanMembership.findFirst({
    where: { userId, connectionId, planId, state: { in: [...states] } },
    include: { connection: true },
  });
  if (!membership) throw notFound();
  const { connection: account, ...rest } = membership;
  // The connection is the person's own (the membership hangs off it); it must still allow plans.
  if (!connectionAllowsPlans(account)) throw notShared(account.origin);
  return { account, membership: rest };
}

async function endMembership(m: Pick<Membership, "id" | "connectionId" | "planId" | "userId">) {
  await prisma.remotePlanMembership.updateMany({
    where: { id: m.id, state: { in: ["invited", "active"] } },
    data: { state: "ended", endedAt: new Date() },
  });
  forgetPlan(m.userId, m.connectionId, m.planId);
}

/** Ask the host; map its answer to this server's errors. `notShared` ends the membership here. */
async function ask(
  ctx: Context,
  make: (a: { from: string; to: string; planId: string }) => PlanPacket,
  transport = PLAN_TRANSPORT
): Promise<PlanReply> {
  const { account, membership } = ctx;
  let reply: PlanReply;
  try {
    reply = await callPeer(
      account.origin,
      make({ from: account.localChannel, to: account.channel, planId: membership.planId }),
      transport
    );
  } catch (error) {
    if (error instanceof PlanPeerUnreachable) throw unreachable(account.origin);
    throw error;
  }
  if (reply.status === "notShared") {
    await endMembership(membership);
    throw notShared(account.origin);
  }
  if (reply.status === "notFound") throw notFound();
  if (reply.status === "error")
    throw new AppError(
      reply.message,
      reply.httpStatus,
      reply.code as ApiErrorCode | undefined,
      reply.field,
      reply.extra
    );
  return reply;
}

const header = () => messageHeader();

// ---------------------------------------------------------------------------- read cache

interface Cached {
  etag: string;
  data: unknown;
  at: number;
}
const cache = new Map<string, Cached>();
const keyOf = (userId: string, connectionId: string, planId: string) =>
  `${userId}:${connectionId}:${planId}`;

function forgetPlan(userId: string, connectionId: string, planId: string): void {
  cache.delete(keyOf(userId, connectionId, planId));
}
export const resetRemotePlanCache = (): void => cache.clear();

function remember(key: string, etag: string | undefined, data: unknown): void {
  if (!etag) return;
  cache.set(key, { etag, data, at: Date.now() });
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

export type PlanRead =
  { notModified: true; etag: string } | { notModified: false; etag: string; data: unknown };

/**
 * The plan view. While the last read is younger than `READ_CACHE_MS` it answers from here -
 * `notModified` when the client holds that very ETag - without asking the host. Later it asks
 * the host with the client's ETag (or the cached one), which answers `notModified` or the view.
 */
export async function readRemotePlan(
  userId: string,
  connectionId: string,
  planId: string,
  ifNoneMatch?: string
): Promise<PlanRead> {
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  const key = keyOf(userId, connectionId, planId);
  const held = cache.get(key);
  if (held && Date.now() - held.at < READ_CACHE_MS)
    return ifNoneMatch === held.etag
      ? { notModified: true, etag: held.etag }
      : { notModified: false, etag: held.etag, data: held.data };
  const reply = await ask(ctx, (a) => ({
    kind: "plan-read",
    ...header(),
    ...a,
    ...((ifNoneMatch ?? held?.etag) ? { ifNoneMatch: ifNoneMatch ?? held?.etag } : {}),
  }));
  if (reply.status !== "ok") throw unexpectedReply(ctx.account.origin);
  if (reply.notModified && reply.etag) {
    // The host's answer confirms what we hold (or what the client holds): refresh the clock.
    if (held && held.etag === reply.etag) {
      held.at = Date.now();
      return ifNoneMatch === held.etag
        ? { notModified: true, etag: held.etag }
        : { notModified: false, etag: held.etag, data: held.data };
    }
    return { notModified: true, etag: reply.etag };
  }
  if (reply.data === undefined || !reply.etag) throw unexpectedReply(ctx.account.origin);
  remember(key, reply.etag, reply.data);
  return { notModified: false, etag: reply.etag, data: reply.data };
}

/** A well-formed answer to another question than the one asked: the other server's fault. */
const unexpectedReply = (origin: string) =>
  refuse("REMOTE_PLAN_UNREACHABLE", 503, "The server of that plan answered unexpectedly", origin);

function data(reply: PlanReply, origin: string): unknown {
  if (reply.status !== "ok" || reply.data === undefined) throw unexpectedReply(origin);
  return reply.data;
}

// ------------------------------------------------------------------------------- writes

/**
 * A plan write, forwarded unchanged with its `clientRef`: a replay after a 503 meets the host's
 * stored receipt, never a second mutation. The host validates the body; this server only
 * insists it is an object.
 */
export async function mutateRemotePlan(
  userId: string,
  connectionId: string,
  planId: string,
  body: unknown
): Promise<unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new AppError("A plan write is an object", 400);
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  const reply = await ask(ctx, (a) => ({
    kind: "plan-mutate",
    ...header(),
    ...a,
    body: body as never,
  }));
  const view = data(reply, ctx.account.origin);
  // The writer's next read sees its own write: cache the answer under the host's ETag.
  const key = keyOf(userId, connectionId, planId);
  if (reply.status === "ok" && reply.etag) remember(key, reply.etag, view);
  else cache.delete(key);
  return view;
}

export async function collabRemotePlan(userId: string, connectionId: string, planId: string) {
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  return data(
    await ask(ctx, (a) => ({ kind: "plan-collab", ...header(), ...a })),
    ctx.account.origin
  );
}

export async function readNoticesRemotePlan(userId: string, connectionId: string, planId: string) {
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  return data(
    await ask(ctx, (a) => ({ kind: "plan-notices-read", ...header(), ...a })),
    ctx.account.origin
  );
}

export async function listRemotePlanDocuments(
  userId: string,
  connectionId: string,
  planId: string
) {
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  return data(
    await ask(ctx, (a) => ({ kind: "plan-doc-list", ...header(), ...a })),
    ctx.account.origin
  );
}

export interface RemoteFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

function fileOf(reply: PlanReply, origin: string): RemoteFile {
  if (reply.status !== "file") throw unexpectedReply(origin);
  return {
    filename: reply.filename,
    contentType: reply.contentType,
    bytes: Buffer.from(reply.dataBase64, "base64"),
  };
}

export async function getRemotePlanDocument(
  userId: string,
  connectionId: string,
  planId: string,
  documentId: string
): Promise<RemoteFile> {
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  const reply = await ask(
    ctx,
    (a) => ({ kind: "plan-doc-get", ...header(), ...a, documentId }),
    PLAN_DOWNLOAD_TRANSPORT
  );
  return fileOf(reply, ctx.account.origin);
}

export async function putRemotePlanDocument(
  userId: string,
  connectionId: string,
  planId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  bookingId?: string
): Promise<unknown> {
  // The plan's own ceiling (the smaller of 20 MB and the largest format's limit), checked before
  // a byte leaves this server.
  if (file.buffer.length > PLAN_DOCUMENT_MAX_BYTES)
    throw refuse("PLAN_DOCUMENT_TOO_LARGE", 413, "Document too large");
  const dataBase64 = file.buffer.toString("base64");
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  const reply = await ask(
    ctx,
    (a) => ({
      kind: "plan-doc-put",
      ...header(),
      ...a,
      name: file.originalname.slice(0, 255) || "document",
      mimetype: file.mimetype.slice(0, 120) || "application/octet-stream",
      ...(bookingId ? { bookingId } : {}),
      dataBase64,
    }),
    PLAN_UPLOAD_TRANSPORT
  );
  return data(reply, ctx.account.origin);
}

export async function exportRemotePlan(
  userId: string,
  connectionId: string,
  planId: string
): Promise<RemoteFile> {
  const ctx = await contextOf(userId, connectionId, planId, ["active"]);
  const reply = await ask(
    ctx,
    (a) => ({ kind: "plan-export", ...header(), ...a }),
    PLAN_DOWNLOAD_TRANSPORT
  );
  return fileOf(reply, ctx.account.origin);
}

// ---------------------------------------------------------------------- the invitation

/**
 * Accept: the host must take the join before it counts here, so a plan never shows as joined that
 * the host does not know. A miss changes nothing and can be tried again; `notShared` ends it.
 */
export async function acceptRemotePlan(
  userId: string,
  connectionId: string,
  planId: string
): Promise<RemotePlanSummary> {
  const ctx = await contextOf(userId, connectionId, planId, ["invited", "active"]);
  if (ctx.membership.state === "invited") {
    await ask(ctx, (a) => ({ kind: "plan-join", ...header(), ...a }));
    await prisma.remotePlanMembership.updateMany({
      where: { id: ctx.membership.id, state: "invited" },
      data: { state: "active", joinedAt: new Date() },
    });
  }
  const done = await prisma.remotePlanMembership.findUniqueOrThrow({
    where: { id: ctx.membership.id },
  });
  return summaryOf(done, ctx.account.origin);
}

/** Decline or leave: ends here at once; the host is told through the retried outbox. */
async function endAndTell(
  userId: string,
  connectionId: string,
  planId: string,
  from: "invited" | "active",
  to: "declined" | "left",
  kind: "plan-decline" | "plan-leave"
): Promise<void> {
  await requireTripFederation(userId);
  const membership = await prisma.remotePlanMembership.findFirst({
    where: { userId, connectionId, planId, state: from },
    include: { connection: true },
  });
  if (!membership) throw notFound();
  const ended = await prisma.remotePlanMembership.updateMany({
    where: { id: membership.id, state: from },
    data: { state: to, endedAt: new Date() },
  });
  forgetPlan(userId, connectionId, planId);
  if (ended.count !== 1) throw notFound();
  const { connection: account } = membership;
  await announce(account, kind, { from: account.localChannel, to: account.channel, planId });
}

export const declineRemotePlan = (userId: string, connectionId: string, planId: string) =>
  endAndTell(userId, connectionId, planId, "invited", "declined", "plan-decline");

export const leaveRemotePlan = (userId: string, connectionId: string, planId: string) =>
  endAndTell(userId, connectionId, planId, "active", "left", "plan-leave");

export { countPlanInvites } from "./memberServe";
