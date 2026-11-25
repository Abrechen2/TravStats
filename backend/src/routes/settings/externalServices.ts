/**
 * Einstellungen › Dienste (forgejo#392): what this account may connect or
 * bring, and its consent to cloud AI. Mounted under
 * `/api/v1/settings/external-services`; the parent applies `authenticate`,
 * `requireWriteScope` and the shared-demo write guard. Bare response family.
 */
import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { serviceTestLimiter } from "../../middleware/serviceTestLimiter";
import {
  accountServiceUpdateSchema,
  aiConsentBodySchema,
  aiConsentParamsSchema,
} from "../../schemas/externalServices";
import { buildAccountView } from "../../services/externalServices/accountView";
import { applyAccountUpdate, setAiConsent } from "../../services/externalServices/accountWrite";
import {
  listUseConsents,
  revokeUseConsent,
  USE_CONSENT_SERVICES,
  type UseConsentServiceId,
} from "../../services/externalServices/useConsent";
import { AppError } from "../../middleware/errorHandler";
import { testAccountService } from "../../services/externalServices/testRunner";

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
      const { consent, destination } = aiConsentBodySchema.parse(req.body);
      res.json(await setAiConsent(req.userId!, provider, consent, destination));
    } catch (error) {
      next(error);
    }
  }
);

/**
 * "Immer erlauben" of each outbound use (owner, 2026-11-25): what this account
 * allowed for good, and the revoke that brings the confirmation back.
 */
router.get(
  "/use-consents",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ consents: await listUseConsents(req.userId!) });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/use-consents/:id",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      if (!(USE_CONSENT_SERVICES as readonly string[]).includes(id)) {
        throw new AppError("Unknown service", 404);
      }
      await revokeUseConsent(req.userId!, id as UseConsentServiceId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Tests the account's OWN credential and persists the verdict (`lastTest`).
 * Registered before `/:id` writes only by method; the path is distinct.
 */
router.post(
  "/:id/test",
  serviceTestLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await testAccountService(String(req.params.id), req.userId!));
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
