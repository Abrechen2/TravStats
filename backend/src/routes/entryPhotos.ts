import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { immichProxyLimiter, statsLimiter } from "../middleware/rateLimit";
import {
  assetSizeSchema,
  linkedAssetIdParamSchema,
  photoSourceKindSchema,
} from "../schemas/immich";
import { sendPlaceholder, streamAsset } from "../services/immich/assetStream";
import { ImmichError } from "../services/immich/types";
import { ENTRY_FK, isEntryKind, type EntryKind } from "../services/photoLinking/entryKinds";
import {
  clearRefusals,
  entrySuggestionsFor,
  isCachedSuggestion,
  linkPicked,
  listEntryLinks,
  removeAutoLinks,
  removeLink,
} from "../services/photoLinking/entryPhotos";
import { entryChoicesFor, saveEntryChoice } from "../services/photoLinking/entryChoices";
import { planFor } from "../services/photoLinking/entryKinds";
import { createPhotoSource } from "../services/photoSource";
import { getPhotoSourceConnection } from "../services/photoSource/connection";
import { prisma } from "../db";
import logger from "../utils/logger";

/**
 * Library photos linked to an entry other than a place visit: a flight, a stay,
 * a rail/bus/ferry journey, a rental, a cruise stop, a roadtrip station
 * (`/entry-photos/:kind/:entryId/...`). The matching is `photoLinking/matcher.ts`;
 * this file is the surface: list, suggestions, manual link, remove, and the
 * thumbnail proxy. Own-account only — the entry is looked up by the caller.
 *
 * A library id is only served after the server found it itself: a link row of the
 * caller, or a suggestion the server searched for in the last minute.
 */
const router = Router();
router.use(authenticate);
router.use(requireWriteScope);

const entryParams = z.object({
  kind: z.string().refine(isEntryKind, "Invalid entry kind"),
  entryId: z.string().uuid(),
});
const picksSchema = z
  .object({
    provider: photoSourceKindSchema.default("immich"),
    assetIds: z.array(linkedAssetIdParamSchema).min(1).max(100),
  })
  .strict();

const pickedSchema = z.object({
  provider: photoSourceKindSchema,
  assetId: linkedAssetIdParamSchema,
});
const albumPickSchema = z
  .object({
    provider: photoSourceKindSchema,
    albumId: z.string().min(1).max(200),
    anyDate: z.boolean().default(false),
  })
  .strict();
export const choiceSaveSchema = z
  .object({
    select: z.array(pickedSchema).max(100).default([]),
    deselect: z.array(pickedSchema).max(100).default([]),
    /** The album the picks were listed from ("Aus Album wählen"). */
    album: albumPickSchema.optional(),
  })
  .strict();
const choiceQuerySchema = z.object({
  all: z.enum(["1", "true"]).optional(),
  provider: photoSourceKindSchema.optional(),
  albumId: z.string().min(1).max(200).optional(),
  anyDate: z.enum(["1", "true"]).optional(),
});

function parseEntry(params: unknown): { kind: EntryKind; entryId: string } {
  const parsed = entryParams.safeParse(params);
  if (!parsed.success) throw new AppError("Invalid entry", 400);
  return { kind: parsed.data.kind as EntryKind, entryId: parsed.data.entryId };
}

router.get(
  "/:kind/:entryId/photos",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const photos = await listEntryLinks(req.userId!, kind, entryId);
      if (photos === null) throw new AppError("Entry not found", 404);
      res.json({ success: true, data: { photos } });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:kind/:entryId/photo-suggestions",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const result = await entrySuggestionsFor(req.userId!, kind, entryId);
      if (result === null) throw new AppError("Entry not found", 404);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/** "Fotos auswählen": every candidate, the linked ones ticked. */
router.get(
  "/:kind/:entryId/photo-choices",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const query = choiceQuerySchema.safeParse(req.query);
      if (!query.success) throw new AppError("Invalid query", 400);
      const { all, provider, albumId, anyDate } = query.data;
      if ((provider === undefined) !== (albumId === undefined)) {
        throw new AppError("provider and albumId go together", 400);
      }
      const result = await entryChoicesFor(req.userId!, kind, entryId, undefined, {
        all: all !== undefined,
        album:
          provider && albumId ? { provider, albumId, anyDate: anyDate !== undefined } : undefined,
      });
      if (result === null) throw new AppError("Entry not found", 404);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * The albums and folders of one connected source, for "Aus Album wählen". The same listing the
 * trip gallery's album picker reads, but scoped to the entry (the user owns it) not to a trip.
 */
router.get(
  "/:kind/:entryId/photo-albums",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const provider = photoSourceKindSchema.safeParse(req.query.provider ?? "immich");
      if (!provider.success) throw new AppError("Invalid provider", 400);
      if ((await planFor(req.userId!, kind, entryId)) === null) {
        throw new AppError("Entry not found", 404);
      }
      const conn = await getPhotoSourceConnection(provider.data, req.userId!);
      if (!conn) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }
      const albums = await createPhotoSource(provider.data, conn).listAlbums();
      res.json({ success: true, data: { provider: provider.data, albums } });
    } catch (error) {
      if (error instanceof ImmichError) {
        logger.warn({ message: "immich_upstream_failure", context: { kind: error.kind } });
        res.status(502).json({ error: error.kind });
        return;
      }
      next(error);
    }
  }
);

router.put(
  "/:kind/:entryId/photo-choices",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const body = choiceSaveSchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError(body.error.message, 400);
      const { album, ...change } = body.data;
      const result = await saveEntryChoice(req.userId!, kind, entryId, change, undefined, {
        album,
      });
      if (result === null) throw new AppError("Entry not found", 404);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:kind/:entryId/photos",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const body = picksSchema.safeParse(req.body ?? {});
      if (!body.success) throw new AppError(body.error.message, 400);
      const picks = [...new Set(body.data.assetIds)].map((assetId) => ({
        provider: body.data.provider,
        assetId,
      }));
      const result = await linkPicked(req.userId!, kind, entryId, picks);
      if (result === null) throw new AppError("Entry not found", 404);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/** Remove every automatically linked photo; each becomes a refusal. */
router.delete(
  "/:kind/:entryId/photos/auto",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const removed = await removeAutoLinks(req.userId!, kind, entryId);
      if (removed === null) throw new AppError("Entry not found", 404);
      res.json({ success: true, data: { removed } });
    } catch (error) {
      next(error);
    }
  }
);

/** Offer the refused photos again. */
router.delete(
  "/:kind/:entryId/photo-refusals",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const cleared = await clearRefusals(req.userId!, kind, entryId);
      if (cleared === null) throw new AppError("Entry not found", 404);
      res.json({ success: true, data: { cleared } });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:kind/:entryId/photos/:photoId",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const photoId = z.string().uuid().safeParse(req.params.photoId);
      if (!photoId.success) throw new AppError("Invalid photo id", 400);
      if (!(await removeLink(req.userId!, kind, entryId, photoId.data))) {
        throw new AppError("Photo not found", 404);
      }
      res.json({ success: true, data: { removed: 1 } });
    } catch (error) {
      next(error);
    }
  }
);

/** Bytes of a linked photo (`:photoId`) or, with `?suggested=provider:assetId`, of a suggestion. */
router.get(
  "/:kind/:entryId/photos/:photoId/file",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const photoId = z.string().uuid().safeParse(req.params.photoId);
      if (!photoId.success) throw new AppError("Invalid photo id", 400);
      const size = assetSizeSchema.safeParse(req.query.size ?? "thumbnail");
      if (!size.success) throw new AppError("Invalid size", 400);
      const link = await prisma.entryPhotoLink.findFirst({
        where: {
          id: photoId.data,
          userId: req.userId!,
          refused: false,
          [ENTRY_FK[kind]]: entryId,
        },
      });
      // One answer for "not yours", "not this entry" and "removed".
      if (!link) throw new AppError("notFound", 404);
      const provider = photoSourceKindSchema.parse(link.provider);
      await sendAsset(req, res, provider, link.assetId, size.data);
    } catch (error) {
      handleStreamError(error, res, next);
    }
  }
);

router.get(
  "/:kind/:entryId/photo-suggestions/:provider/:assetId/file",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { kind, entryId } = parseEntry(req.params);
      const provider = photoSourceKindSchema.safeParse(req.params.provider);
      const assetId = linkedAssetIdParamSchema.safeParse(req.params.assetId);
      if (!provider.success || !assetId.success) throw new AppError("Invalid asset", 400);
      const size = assetSizeSchema.safeParse(req.query.size ?? "thumbnail");
      if (!size.success) throw new AppError("Invalid size", 400);
      if (!isCachedSuggestion(req.userId!, kind, entryId, provider.data, assetId.data)) {
        throw new AppError("notFound", 404);
      }
      await sendAsset(req, res, provider.data, assetId.data, size.data);
    } catch (error) {
      handleStreamError(error, res, next);
    }
  }
);

async function sendAsset(
  req: AuthRequest,
  res: Response,
  provider: z.infer<typeof photoSourceKindSchema>,
  assetId: string,
  size: z.infer<typeof assetSizeSchema>
): Promise<void> {
  const etag = `"${provider === "immich" ? "" : `${provider}-`}${assetId}-${size}"`;
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  const conn = await getPhotoSourceConnection(provider, req.userId!);
  if (!conn) {
    res.status(409).json({ error: "notConfigured" });
    return;
  }
  await streamAsset(res, createPhotoSource(provider, conn), assetId, size, etag);
}

function handleStreamError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ImmichError) {
    logger.warn({ message: "immich_proxy_upstream_failure", context: { kind: error.kind } });
    sendPlaceholder(res, error.kind === "notFound" ? 404 : 502);
    return;
  }
  next(error);
}

export default router;
