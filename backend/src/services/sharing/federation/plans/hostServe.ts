/**
 * The host side of plans over a connection (spec 2026-11-02 §4): the answers to `plan-join`,
 * `plan-decline`, `plan-leave` and the proxied plan calls. The route has authenticated the peer;
 * everything in a body is that server's word, and a signature alone grants nothing.
 *
 * EVERY call re-checks, in this order, and any miss answers the same `notShared`:
 *   peer pinned, enabled and verified -> the signed channel pair resolves to a connection of this
 *   server -> the connection is active and both sides have plans on -> an ACTIVE remote member is
 *   bound to that connection and that plan -> the member's allowance for the minute -> only then
 *   the plan service, which asks `planAccess` again and refuses owner-only acts for a member.
 * A revoked connection or a switch turned off therefore ends access on the next call.
 */
import { Writable } from "node:stream";
import fs from "node:fs";
import { ZodError } from "zod";
import { prisma } from "../../../../db";
import { AppError } from "../../../../middleware/errorHandler";
import logger from "../../../../utils/logger";
import type { Prisma } from "../../../../prisma";
import {
  PLAN_DOC_BASE64_MAX,
  type PlanDecline,
  type PlanJoin,
  type PlanLeave,
  type PlanProxyPacket,
  type PlanReply,
} from "../../../../schemas/tripSharePlans";
import { collab, markNoticesRead } from "../../../travplan/members";
import {
  listPlanDocuments,
  PLAN_DOCUMENT_MAX_BYTES,
  readPlanDocument,
  uploadPlanDocument,
} from "../../../travplan/planDocuments";
import { readPlan, writePlan } from "../../../travplan/store";
import { writeSchema } from "../../../travplan/schema";
import type { RemoteActor } from "../../../travplan/access";
import { planAccess } from "../../../travplan/access";
import { documentPath } from "../../../documents/documentStore";
import { collectTrip } from "../../../trip/exchange/collect";
import { scopeFileForRemoteMember } from "../../../trip/exchange/memberScope";
import { TRIP_FILE_EXTENSION } from "../../../trip/exchange/format";
import {
  buildManifest,
  presentFiles,
  writeTripArchive,
} from "../../../trip/exchange/writeArchive";
import { connectionAllowsPlans } from "../connections/switches";
import { takeRemoteCall } from "./rateLimit";
import { planEtag } from "./shared";

type Account = Prisma.RemoteShareAccountGetPayload<object>;

const NOT_SHARED: PlanReply = { kind: "plan-reply", status: "notShared" };
const ok = (data?: unknown, etag?: string): PlanReply => ({
  kind: "plan-reply",
  status: "ok",
  ...(etag ? { etag } : {}),
  ...(data === undefined ? {} : { data: data as never }),
});

/** This server's side of the connection a message addresses: `to` is ours, `from` theirs. */
export async function connectionOf(
  origin: string,
  from: string,
  to: string
): Promise<Account | null> {
  const row = await prisma.remoteShareAccount.findUnique({
    where: { origin_localChannel: { origin, localChannel: to } },
  });
  return row && row.channel === from ? row : null;
}

/** Pinned, enabled and verified by this server's admin - asked again on every call. */
async function peerAdmitted(origin: string): Promise<boolean> {
  const peer = await prisma.comparisonPeer.findUnique({ where: { origin } });
  return !!peer?.enabled && !!peer.verifiedAt;
}

/** The connection of a message, if the peer and connection still allow plans. */
async function liveConnection(
  origin: string,
  from: string,
  to: string
): Promise<Account | null> {
  if (!(await peerAdmitted(origin))) return null;
  const account = await connectionOf(origin, from, to);
  return account && connectionAllowsPlans(account) ? account : null;
}

// ------------------------------------------------------------------ join / decline / leave

/** Answer to an invitation: the invited member becomes active. A repeat is the same answer. */
export async function servePlanJoin(origin: string, body: PlanJoin): Promise<PlanReply> {
  const account = await liveConnection(origin, body.from, body.to);
  if (!account) return NOT_SHARED;
  const member = await prisma.travelPlanMember.findFirst({
    where: { planId: body.planId, kind: "remote", connectionId: account.id },
  });
  if (!member) return NOT_SHARED;
  if (member.status === "active") return ok();
  if (member.status !== "invited") return NOT_SHARED;
  const joined = await prisma.travelPlanMember.updateMany({
    where: { id: member.id, status: "invited" },
    data: { status: "active", joinedAt: new Date() },
  });
  return joined.count === 1 ? ok() : NOT_SHARED;
}

/** Ending a membership is accepted even when the connection has since gone: it only ends access. */
async function endMembership(
  origin: string,
  from: string,
  to: string,
  planId: string,
  wasStatus: "invited" | "active"
): Promise<PlanReply> {
  const account = await connectionOf(origin, from, to);
  if (!account) return NOT_SHARED;
  // A repeat finds nothing to end and says the same.
  await prisma.travelPlanMember.updateMany({
    where: { planId, kind: "remote", connectionId: account.id, status: wasStatus },
    data: { status: "left", revokedAt: new Date() },
  });
  return ok();
}

export const servePlanDecline = (origin: string, body: PlanDecline) =>
  endMembership(origin, body.from, body.to, body.planId, "invited");
export const servePlanLeave = (origin: string, body: PlanLeave) =>
  endMembership(origin, body.from, body.to, body.planId, "active");

// -------------------------------------------------------------------------- proxied calls

interface Guarded {
  actor: RemoteActor;
  tripId: string;
  memberId: string;
}

async function guard(origin: string, body: PlanProxyPacket): Promise<Guarded | null> {
  const account = await liveConnection(origin, body.from, body.to);
  if (!account) return null;
  const member = await prisma.travelPlanMember.findFirst({
    where: {
      planId: body.planId,
      kind: "remote",
      connectionId: account.id,
      status: "active",
    },
    select: { id: true, role: true, plan: { select: { tripId: true } } },
  });
  // The role is checked here as well as in the plan service: a remote member is an editor, never more.
  if (!member || member.role !== "editor") return null;
  return {
    actor: { remote: { memberId: member.id, planId: body.planId } },
    tripId: member.plan.tripId,
    memberId: member.id,
  };
}

const WRITES = new Set<PlanProxyPacket["kind"]>(["plan-mutate", "plan-doc-put", "plan-notices-read"]);

/** The plan's own refusal, passed on with its machine code; a refusal of access is `notShared`. */
function failureReply(error: unknown): PlanReply {
  if (error instanceof ZodError)
    return {
      kind: "plan-reply",
      status: "error",
      httpStatus: 400,
      message: "Invalid input",
      field: error.issues[0]?.path.join(".").slice(0, 80) || undefined,
    };
  if (error instanceof AppError) {
    if (error.code === "REMOTE_PLAN_NOT_SHARED" || error.code === "PLAN_NOT_FOUND")
      return NOT_SHARED;
    if (error.code === "PLAN_DOCUMENT_NOT_FOUND") return { kind: "plan-reply", status: "notFound" };
    return {
      kind: "plan-reply",
      status: "error",
      httpStatus: error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500,
      message: error.message.slice(0, 500),
      ...(error.code ? { code: error.code } : {}),
      ...(error.field ? { field: error.field } : {}),
      ...(error.extra ? { extra: { ...error.extra } } : {}),
    };
  }
  throw error;
}

export async function servePlanProxy(origin: string, body: PlanProxyPacket): Promise<PlanReply> {
  const guarded = await guard(origin, body);
  if (!guarded) return NOT_SHARED;
  if (!takeRemoteCall(guarded.memberId, WRITES.has(body.kind)))
    return {
      kind: "plan-reply",
      status: "error",
      httpStatus: 429,
      message: "Too many requests",
      code: "REMOTE_PLAN_RATE_LIMITED",
    };
  try {
    return await dispatch(body, guarded);
  } catch (error) {
    try {
      return failureReply(error);
    } catch (unexpected) {
      logger.error(
        { operation: "remote_plan_serve_failed", kind: body.kind, err: unexpected },
        "A remote plan call failed on the host"
      );
      throw unexpected;
    }
  }
}

async function dispatch(body: PlanProxyPacket, g: Guarded): Promise<PlanReply> {
  switch (body.kind) {
    case "plan-read": {
      const view = await readPlan(g.actor, g.tripId);
      const etag = planEtag(view);
      if (body.ifNoneMatch === etag)
        return { kind: "plan-reply", status: "ok", etag, notModified: true };
      return ok(view, etag);
    }
    case "plan-mutate": {
      const view = await writePlan(g.actor, g.tripId, writeSchema.parse(body.body));
      return ok(view, planEtag(view));
    }
    case "plan-collab":
      return ok(await collab(g.actor, g.tripId));
    case "plan-notices-read":
      return ok(await markNoticesRead(g.actor, g.tripId));
    case "plan-doc-list":
      return ok({ documents: await listPlanDocuments(g.actor, g.tripId) });
    case "plan-doc-get":
      return documentFile(g, body.documentId);
    case "plan-doc-put": {
      const bytes = Buffer.from(body.dataBase64, "base64");
      if (bytes.length > PLAN_DOCUMENT_MAX_BYTES)
        throw new AppError("Document too large", 413, "PLAN_DOCUMENT_TOO_LARGE");
      const dto = await uploadPlanDocument(
        g.actor,
        g.tripId,
        { buffer: bytes, originalname: body.name, mimetype: body.mimetype },
        body.bookingId
      );
      return ok(dto);
    }
    case "plan-export":
      return exportFile(g);
  }
}

async function documentFile(g: Guarded, documentId: string): Promise<PlanReply> {
  const doc = await readPlanDocument(g.actor, g.tripId, documentId);
  const filePath = documentPath(doc.storedName);
  if (!fs.existsSync(filePath)) return { kind: "plan-reply", status: "notFound" };
  const bytes = await fs.promises.readFile(filePath);
  if (bytes.length > PLAN_DOCUMENT_MAX_BYTES)
    throw new AppError("Document too large", 413, "PLAN_DOCUMENT_TOO_LARGE");
  return fileReply(doc.originalName ?? "document", doc.mimetype, bytes);
}

function fileReply(filename: string, contentType: string, bytes: Buffer): PlanReply {
  const dataBase64 = bytes.toString("base64");
  if (dataBase64.length > PLAN_DOC_BASE64_MAX)
    throw new AppError("File too large", 413, "PLAN_DOCUMENT_TOO_LARGE");
  return { kind: "plan-reply", status: "file", filename, contentType, dataBase64 };
}

/**
 * The plan's trip as a `.travstats` file, scoped to what the plan shows a member
 * (`scopeFileForRemoteMember`): the roadtrip with its stations, legs and ferry links and only the
 * stays and crossings those name. Bookings (PNRs, references, prices), documents, photos, the
 * journal, notes and companions stay with the owner. Read-only.
 */
async function exportFile(g: Guarded): Promise<PlanReply> {
  const { ownerId } = await planAccess(g.actor, g.tripId);
  const options = { documents: false, photos: false, private: false };
  const full = await collectTrip(ownerId, g.tripId, options);
  const collected = presentFiles({ ...full, file: scopeFileForRemoteMember(full.file), files: [] });
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk);
      done();
    },
  });
  const now = new Date();
  await writeTripArchive(collected, buildManifest(options, now, collected.file), sink);
  const name = collected.tripName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "trip";
  return fileReply(
    `${name}-${now.toISOString().slice(0, 10)}${TRIP_FILE_EXTENSION}`,
    "application/zip",
    Buffer.concat(chunks)
  );
}
