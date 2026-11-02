/**
 * Documents on a plan (spec 2026-10-17 D6, §6.8). A co-planner or guest sees exactly two kinds:
 * the documents attached to the plan's bookings, and the ones any member uploaded explicitly for
 * the plan (`travel_plan_documents`). Every other document of the trip stays invisible to them,
 * decided here on the server from the table, not by a client filter. Uploads live on the host,
 * belong to the owner's trip like any kept original, and carry the uploader's name.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { createDocument, deleteDocument } from "../documents/documentService";
import { sha256Hex } from "../documents/documentStore";
import { DOCUMENT_MAX_BYTES } from "../documents/documentFormats";
import { planAccess, type PlanActor } from "./access";
import { parseState } from "./upgrade";
import type { Document } from "../../prisma";

/** Spec §6.5: uploads up to 20 MB each, at most 50 documents per plan per member. */
export const PLAN_DOCUMENT_MAX_BYTES = Math.min(20 * 1024 * 1024, DOCUMENT_MAX_BYTES);
export const PLAN_DOCUMENTS_PER_MEMBER = 50;

export interface PlanDocumentDto {
  id: string;
  displayName: string;
  mimetype: string;
  format: string;
  sizeBytes: number;
  createdAt: string;
  /** Who put it on the plan; null for a booking's own document the owner kept. */
  uploadedBy: { memberId: string; displayName: string } | null;
  bookingId: string | null;
  /** Attached to a booking of the plan. */
  attached: boolean;
}

const nameOf = (d: Pick<Document, "originalName" | "storedName">) =>
  d.originalName ?? `document${d.storedName.slice(d.storedName.lastIndexOf("."))}`;

async function visibleDocuments(actor: PlanActor, tripId: string) {
  const access = await planAccess(actor, tripId);
  const planId = access.row.id;
  const state = parseState(access.row.state);
  const attachedIds = new Set(state.bookings.flatMap((b) => b.documentIds));
  const rows = await prisma.travelPlanDocument.findMany({
    where: { planId },
    include: { uploader: { select: { id: true, displayName: true } } },
  });
  const uploaded = new Map(rows.map((r) => [r.documentId, r]));
  // The owner sees every document of the trip, as everywhere else in the logbook.
  const where = access.isOwner
    ? { userId: access.ownerId, tripId }
    : {
        userId: access.ownerId,
        tripId,
        id: { in: [...new Set([...attachedIds, ...uploaded.keys()])] },
      };
  const documents = await prisma.document.findMany({ where, orderBy: { createdAt: "asc" } });
  return { access, documents, uploaded, attachedIds };
}

export async function listPlanDocuments(
  actor: PlanActor,
  tripId: string
): Promise<PlanDocumentDto[]> {
  const { documents, uploaded, attachedIds } = await visibleDocuments(actor, tripId);
  return documents.map((d) => {
    const row = uploaded.get(d.id);
    return {
      id: d.id,
      displayName: nameOf(d),
      mimetype: d.mimetype,
      format: d.format,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt.toISOString(),
      uploadedBy: row ? { memberId: row.uploader.id, displayName: row.uploader.displayName } : null,
      bookingId: row?.bookingId ?? null,
      attached: attachedIds.has(d.id),
    };
  });
}

/** The stored document if this principal may see it; the 404 of a document that is not there. */
export async function readPlanDocument(
  actor: PlanActor,
  tripId: string,
  documentId: string
): Promise<Document> {
  const { documents } = await visibleDocuments(actor, tripId);
  const found = documents.find((d) => d.id === documentId);
  if (!found) throw new AppError("Document not found", 404, "PLAN_DOCUMENT_NOT_FOUND");
  return found;
}

export async function uploadPlanDocument(
  actor: PlanActor,
  tripId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  bookingId?: string
): Promise<PlanDocumentDto> {
  const access = await planAccess(actor, tripId);
  if (file.buffer.length > PLAN_DOCUMENT_MAX_BYTES)
    throw new AppError(
      `Document too large: at most ${PLAN_DOCUMENT_MAX_BYTES / (1024 * 1024)} MB.`,
      413,
      "PLAN_DOCUMENT_TOO_LARGE"
    );
  if (bookingId && !parseState(access.row.state).bookings.some((b) => b.id === bookingId))
    throw new AppError("Booking not found", 404, "PLAN_ITEM_NOT_FOUND");
  // The same bytes already on the owner's account stay the owner's: keeping them again would
  // file an unfiled private document onto this trip (createDocument promotes it) or reveal one.
  const known = await prisma.document.findFirst({
    where: { userId: access.ownerId, sha256: sha256Hex(file.buffer) },
    select: { id: true, planDocument: { select: { planId: true } } },
  });
  if (known) {
    if (known.planDocument?.planId !== access.row.id)
      throw new AppError(
        "This file is already in the owner's trip",
        409,
        "PLAN_DOCUMENT_DUPLICATE"
      );
    const again = (await listPlanDocuments(actor, tripId)).find((d) => d.id === known.id);
    if (again) return again;
  }
  const { document, created } = await createDocument({
    userId: access.ownerId,
    buffer: file.buffer,
    originalName: file.originalname,
    declaredMime: file.mimetype,
    source: "upload",
    entry: { type: "trip", id: tripId },
  });
  if (!created) {
    // The same bytes are already on the owner's trip. Only if a member already put them on the
    // plan is this a repeat; otherwise it is the owner's private document and stays private.
    const existing = await prisma.travelPlanDocument.findUnique({
      where: { documentId: document.id },
    });
    if (!existing || existing.planId !== access.row.id)
      throw new AppError("This file is already on the trip", 409, "PLAN_DOCUMENT_DUPLICATE");
  } else {
    try {
      // The plan row is locked for the count and the insert, so fifty means fifty.
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM travel_plans WHERE id = ${access.row.id} FOR UPDATE`;
        // Still a member, and a removal waits for this insert (FOR SHARE on the member row).
        const present = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM travel_plan_members
          WHERE id = ${access.member.id} AND status = 'active' FOR SHARE`;
        if (!present.length) throw new AppError("Plan not found", 404, "PLAN_NOT_FOUND");
        const mine = await tx.travelPlanDocument.count({
          where: { planId: access.row.id, uploadedByMemberId: access.member.id },
        });
        if (mine >= PLAN_DOCUMENTS_PER_MEMBER)
          throw new AppError(
            "Too many documents from you on this plan",
            409,
            "PLAN_DOCUMENT_LIMIT"
          );
        await tx.travelPlanDocument.create({
          data: {
            planId: access.row.id,
            documentId: document.id,
            uploadedByMemberId: access.member.id,
            bookingId: bookingId ?? null,
          },
        });
      });
    } catch (error) {
      // An upload that cannot be shown must not stay behind: a retry would meet its own bytes.
      await deleteDocument(access.ownerId, document.id).catch(() => undefined);
      throw error;
    }
  }
  const list = await listPlanDocuments(actor, tripId);
  const dto = list.find((d) => d.id === document.id);
  if (!dto) throw new AppError("Document not found", 404, "PLAN_DOCUMENT_NOT_FOUND");
  return dto;
}
