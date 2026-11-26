/**
 * Trip photo links (docs/superpowers/specs/2026-11-26-trip-photo-links.md): the trip's
 * photo sources (album and period links), the album proposals and the period offer, the
 * merged photo list and the proxy that streams a period's photos. References only —
 * nothing here writes an image byte.
 *
 * Mounted on `/api/v1`, so middleware is PER ROUTE. Every route proves the trip is the
 * caller's first (`resolveTrip`); a source that is not the trip's answers 404.
 * Bare response family (ADR 0001), like the album routes beside it.
 */
import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichProxyLimiter, statsLimiter } from "../../middleware/rateLimit";
import {
  assetSizeSchema,
  galleryDayParamSchema,
  linkedAssetIdParamSchema,
} from "../../schemas/immich";
import { prisma } from "../../db";
import { sendPlaceholder, streamAsset } from "../../services/immich/assetStream";
import { ImmichError } from "../../services/immich/types";
import { createPhotoSource, PHOTO_SOURCE_KINDS } from "../../services/photoSource";
import { getPhotoSourceConnection, toPhotoSourceKind } from "../../services/photoSource/connection";
import { loadTripLinkedPhotos } from "../../services/tripPhotoLinks/mergedPhotos";
import {
  loadPeriodAssets,
  periodDays,
  tripPeriodContext,
  windowZones,
} from "../../services/tripPhotoLinks/periods";
import { loadTripPhotoProposals } from "../../services/tripPhotoLinks/proposals";
import {
  addAlbumSource,
  addPeriodSource,
  dismissProposal,
  listTripPhotoSources,
  removeTripPhotoSource,
} from "../../services/tripPhotoLinks/sources";
import logger from "../../utils/logger";
import { resolveTrip } from "./resolveTrip";

const router = Router();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const provider = z.enum(PHOTO_SOURCE_KINDS as [string, ...string[]]).transform(toPhotoSourceKind);

const addSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("period"),
      connectionId: provider.optional(),
      from: day.optional(),
      until: day.optional(),
    })
    .strict()
    .refine((v) => !v.from || !v.until || v.from <= v.until, { message: "from after until" }),
  z
    .object({
      kind: z.literal("album"),
      connectionId: provider,
      albumId: z.string().min(1).max(64),
    })
    .strict(),
]);

const listQuerySchema = z
  .object({
    day: galleryDayParamSchema.default("all"),
    cursor: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  })
  .strict();

const sourceIdSchema = z.string().uuid();
const proposalKeySchema = z.string().min(1).max(160);

const notFound = (): AppError => new AppError("Trip not found", 404, "TRIP_NOT_FOUND");

router.get(
  "/trips/:id/photo-sources",
  authenticate,
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sources = await listTripPhotoSources(req.userId!, req.params.id);
      if (sources === null) throw notFound();
      res.json({ sources });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/trips/:id/photo-sources",
  authenticate,
  requireWriteScope,
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const tripId = req.params.id;
      await resolveTrip(userId, tripId);
      const body = addSourceSchema.parse(req.body);
      const id =
        body.kind === "period"
          ? await addPeriodSource(userId, tripId, body)
          : await addAlbumSource(userId, tripId, body.connectionId, body.albumId);
      const sources = (await listTripPhotoSources(userId, tripId)) ?? [];
      res.status(201).json({ source: sources.find((s) => s.id === id) ?? null });
    } catch (error) {
      if (error instanceof ImmichError) {
        res.status(502).json({ error: error.kind });
        return;
      }
      next(error);
    }
  }
);

router.get(
  "/trips/:id/photo-sources/proposals",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await loadTripPhotoProposals(req.userId!, req.params.id);
      if (result === null) throw notFound();
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/trips/:id/photo-sources/proposals/:key/dismiss",
  authenticate,
  requireWriteScope,
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const key = proposalKeySchema.safeParse(req.params.key);
      if (!key.success) throw new AppError("Invalid proposal key", 400);
      await dismissProposal(userId, req.params.id, key.data);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/trips/:id/photo-sources/:sourceId",
  authenticate,
  requireWriteScope,
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      await resolveTrip(userId, req.params.id);
      const sourceId = sourceIdSchema.safeParse(req.params.sourceId);
      if (!sourceId.success) throw new AppError("notFound", 404);
      await removeTripPhotoSource(userId, req.params.id, sourceId.data);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * The merged, de-duplicated list, one page of one day bucket (`YYYY-MM-DD`, `undated`
 * or `all`). `days` counts every bucket, so the gallery draws its day strip from the
 * first page and loads each day lazily. Not `/trips/:id/photos`: that path already
 * lists the trip's uploads and its shape is read by the Companion.
 */
router.get(
  "/trips/:id/linked-photos",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listQuerySchema.safeParse(req.query);
      if (!query.success) throw new AppError("Invalid day or page", 400);
      const result = await loadTripLinkedPhotos(req.userId!, req.params.id);
      if (result === null) throw notFound();
      const counts = new Map<string, number>();
      for (const p of result.photos) {
        const bucket = p.day ?? "undated";
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      }
      const days = [...counts.entries()]
        .sort(([a], [b]) => (a === "undated" ? 1 : b === "undated" ? -1 : a.localeCompare(b)))
        .map(([d, count]) => ({ day: d === "undated" ? null : d, count }));
      const { day: bucket, cursor, limit } = query.data;
      const ofDay =
        bucket === "all"
          ? result.photos
          : result.photos.filter((p) => (p.day ?? "undated") === bucket);
      const photos = ofDay.slice(cursor, cursor + limit);
      res.json({
        zone: result.zone,
        totalAll: result.photos.length,
        total: ofDay.length,
        days,
        photos,
        nextCursor: cursor + photos.length < ofDay.length ? String(cursor + photos.length) : null,
        truncated: result.truncated,
        failures: result.failures,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Stream one photo of a period link. The asset must be in THAT period's own search
 * result — otherwise owning any trip would turn the proxy into a reader of the whole
 * library. Same private immutable caching and placeholder as the album proxy.
 */
router.get(
  "/trips/:id/photo-sources/:sourceId/assets/:assetId/file",
  authenticate,
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const ctx = await tripPeriodContext(userId, req.params.id);
      if (ctx === null) throw notFound();
      const assetId = linkedAssetIdParamSchema.safeParse(req.params.assetId);
      const sourceId = sourceIdSchema.safeParse(req.params.sourceId);
      if (!assetId.success || !sourceId.success) throw new AppError("Invalid asset id", 400);
      const size = assetSizeSchema.safeParse(req.query.size);
      if (!size.success) throw new AppError("Invalid size", 400);

      const etag = `"${assetId.data}-${size.data}"`;
      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }
      const period = await prisma.tripPhotoPeriod.findFirst({
        where: { id: sourceId.data, tripId: ctx.trip.id },
      });
      if (!period) throw new AppError("notFound", 404);
      const kind = toPhotoSourceKind(period.provider);
      const days = periodDays(period, ctx.tripDays);
      if (days === null) throw new AppError("notFound", 404);
      const assets = await loadPeriodAssets(userId, kind, days, windowZones(ctx));
      const conn = await getPhotoSourceConnection(kind, userId);
      if (assets === null || conn === null) {
        res.status(409).json({ error: "notConfigured" });
        return;
      }
      if (!assets.some((a) => a.id === assetId.data)) throw new AppError("notFound", 404);
      await streamAsset(res, createPhotoSource(kind, conn), assetId.data, size.data, etag);
    } catch (error) {
      if (error instanceof ImmichError) {
        logger.warn({ message: "period_proxy_upstream_failure", context: { kind: error.kind } });
        sendPlaceholder(res, error.kind === "notFound" ? 404 : 502);
        return;
      }
      next(error);
    }
  }
);

export default router;
