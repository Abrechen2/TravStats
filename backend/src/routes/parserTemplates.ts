import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";

// No rate limiter: all four handlers are single indexed statements against the
// caller's own template rows. Deriving a template is the expensive part and it
// happens in `training.ts`, which is limited — this router only reads and
// edits the result.
const router = Router();
router.use(authenticate);
// Read-scoped PATs may list templates (GET) but not create / update / delete.
router.use(requireWriteScope);

// GET /api/v1/parser-templates
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const templates = await prisma.parserTemplate.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/parser-templates/:id
router.get("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const template = await prisma.parserTemplate.findUnique({ where: { id } });
    if (!template) throw new AppError("Template not found", 404);
    if (template.userId !== userId) throw new AppError("Unauthorized", 403);

    res.json({ template });
  } catch (error) {
    next(error);
  }
});

const patchSchema = z.object({
  status: z.enum(["active", "disabled", "pending"]),
});

// PATCH /api/v1/parser-templates/:id
router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const { status } = patchSchema.parse(req.body);

    const existing = await prisma.parserTemplate.findUnique({ where: { id } });
    if (!existing) throw new AppError("Template not found", 404);
    if (existing.userId !== userId) throw new AppError("Unauthorized", 403);

    const updated = await prisma.parserTemplate.update({
      where: { id },
      data: { status },
    });
    res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/parser-templates/:id
router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const existing = await prisma.parserTemplate.findUnique({ where: { id } });
    if (!existing) throw new AppError("Template not found", 404);
    if (existing.userId !== userId) throw new AppError("Unauthorized", 403);

    await prisma.parserTemplate.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
