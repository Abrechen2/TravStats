/**
 * Administration › Externe Dienste (forgejo#392) — the façade over every
 * outbound service. Mounted under `/api/v1/admin/external-services` behind
 * `requireAdmin`. Bare response family (docs/adr/0001-api-response-shape.md).
 *
 * `/connections/:id` and `/:id/test` are registered before `/:id` so a service
 * can never shadow them.
 */
import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { adminServiceUpdateSchema, connectionAllowedSchema } from "../../schemas/externalServices";
import { buildAdminView } from "../../services/externalServices/adminView";
import {
  applyAdminUpdate,
  applyConnectionAllowed,
} from "../../services/externalServices/adminWrite";
import { testInstanceService } from "../../services/externalServices/testRunner";

const router = Router();

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await buildAdminView());
  } catch (error) {
    next(error);
  }
});

router.put(
  "/connections/:id",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { allowed } = connectionAllowedSchema.parse(req.body);
      await applyConnectionAllowed(String(req.params.id), allowed);
      res.json({ id: req.params.id, allowed });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/:id/test",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await testInstanceService(String(req.params.id)));
    } catch (error) {
      next(error);
    }
  }
);

router.put("/:id", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await applyAdminUpdate(id, adminServiceUpdateSchema.parse(req.body));
    // Answer with the service as it now reads, secrets masked.
    const view = await buildAdminView();
    res.json(view.categories.flatMap((c) => c.services).find((s) => s.id === id));
  } catch (error) {
    next(error);
  }
});

export default router;
