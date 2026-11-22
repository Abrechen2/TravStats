/**
 * "Das bin ich" per photo source. Mounted under `/api/v1/settings/photo-sources`
 * (parent: `authenticate` + `requireWriteScope`).
 *
 * `GET /:provider/people` reads the source's named people on demand — names
 * go to the caller and are stored nowhere. `PUT /:provider/self` keeps ONLY
 * the chosen person's id, after checking it is one of that source's people.
 */
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { immichProxyLimiter } from "../../middleware/rateLimit";
import { photoSourceKindSchema } from "../../schemas/immich";
import { createPhotoSource } from "../../services/photoSource";
import { getPhotoSourceConnection } from "../../services/photoSource/connection";
import { selfPersonId, setSelfPersonId } from "../../services/coverSuggestions/selfPerson";
import { ImmichError } from "../../services/immich/types";

const router = Router();

const selfBodySchema = z.object({ personId: z.string().min(1).max(200).nullable() }).strict();

async function readPeople(userId: string, provider: "immich" | "photoprism") {
  const conn = await getPhotoSourceConnection(provider, userId);
  if (!conn) throw new AppError("notConfigured", 409);
  return createPhotoSource(provider, conn).listPeople();
}

function sendFailure(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ImmichError) {
    res.status(502).json({ error: error.kind, message: error.message });
    return;
  }
  next(error);
}

router.get(
  "/:provider/people",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provider = photoSourceKindSchema.parse(req.params.provider);
      const people = await readPeople(req.userId!, provider);
      res.json({ people, selfPersonId: await selfPersonId(req.userId!, provider) });
    } catch (error) {
      sendFailure(error, res, next);
    }
  }
);

router.put(
  "/:provider/self",
  immichProxyLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const provider = photoSourceKindSchema.parse(req.params.provider);
      const { personId } = selfBodySchema.parse(req.body);
      if (personId !== null) {
        const people = await readPeople(req.userId!, provider);
        if (!people.some((p) => p.id === personId)) throw new AppError("notFound", 404);
      }
      await setSelfPersonId(req.userId!, provider, personId);
      res.json({ selfPersonId: personId });
    } catch (error) {
      sendFailure(error, res, next);
    }
  }
);

export default router;
