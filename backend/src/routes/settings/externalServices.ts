/**
 * Einstellungen › Dienste (forgejo#392): what this account may connect or
 * bring, and its consent to cloud AI. Mounted under
 * `/api/v1/settings/external-services`; the parent applies `authenticate`,
 * `requireWriteScope` and the shared-demo write guard. Bare response family.
 */
import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import {
  accountServiceUpdateSchema,
  aiConsentBodySchema,
  aiConsentParamsSchema,
} from "../../schemas/externalServices";
import { buildAccountView } from "../../services/externalServices/accountView";
import { applyAccountUpdate, setAiConsent } from "../../services/externalServices/accountWrite";

const router = Router();

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await buildAccountView(req.userId!));
  } catch (error) {
    next(error);
  }
});

router.put(
  "/ai-consent/:provider",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { provider } = aiConsentParamsSchema.parse(req.params);
      const { consent } = aiConsentBodySchema.parse(req.body);
      res.json(await setAiConsent(req.userId!, provider, consent));
    } catch (error) {
      next(error);
    }
  }
);

router.put("/:id", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await applyAccountUpdate(req.userId!, id, accountServiceUpdateSchema.parse(req.body));
    const view = await buildAccountView(req.userId!);
    res.json([...view.connections, ...view.ownKeys].find((s) => s.id === id) ?? { id });
  } catch (error) {
    next(error);
  }
});

export default router;
