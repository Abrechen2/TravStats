import { Router, Response, NextFunction } from "express";
import type { ParserTemplate } from "@prisma/client";
import { z } from "zod";
import { authenticate, requireWriteScope, AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import { previewTemplate, type TemplatePreview } from "../services/parsers/userTemplates/preview";
import type {
  TemplateDomain,
  TemplateFingerprint,
  TemplatePatterns,
  UserTemplate,
} from "../services/parsers/userTemplates/types";
import { isWorkshopDomain } from "../shared/annotationLabels";
import logger from "../utils/logger";

// No rate limiter: all four handlers are single indexed statements against the
// caller's own template rows. Deriving a template is the expensive part and it
// happens in `training.ts`, which is limited — this router only reads and
// edits the result. The preview below runs one regex pass over at most two of
// the caller's own samples, which is the same order of cost as a parse.
const router = Router();
router.use(authenticate);
// Read-scoped PATs may list templates (GET) but not create / update / delete.
router.use(requireWriteScope);
// The shared demo account READS this page — the parser workshop is what the
// public preview exists to show — but it does not activate, disable or delete
// templates. Those rows are shared by every visitor logged into that account,
// so one visitor's tidy-up is the next one's missing template. Reading is the
// showcase; writing is not (finding I2's reasoning, applied to this router).
router.use(rejectDemoWrites);

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

/**
 * What a preview run recorded, kept on the template's own `stats`.
 *
 * `previewOf` is the template's `updatedAt` at the moment it was run. A
 * re-derivation writes new patterns and a new timestamp, so a stale proof
 * stops counting on its own rather than having to be found and deleted —
 * the same idea as an ETag, and for the same reason: the thing that was
 * proven is the BYTES, not the row.
 */
interface PreviewRecord {
  at: string;
  previewOf: string;
  passed: boolean;
  ownSampleId: string;
  heldOutSampleId: string | null;
}

interface StoredStats {
  matchCount?: number;
  successRate?: number;
  lastUsedAt?: string;
  preview?: PreviewRecord;
}

function readStats(stats: unknown): StoredStats {
  return typeof stats === "object" && stats !== null ? (stats as StoredStats) : {};
}

function toUserTemplate(row: ParserTemplate): UserTemplate {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    status: row.status as UserTemplate["status"],
    fingerprint: row.fingerprint as unknown as TemplateFingerprint,
    patterns: row.patterns as unknown as TemplatePatterns,
    sourceId: row.sourceId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function domainOf(row: ParserTemplate): TemplateDomain {
  return isWorkshopDomain(row.domain) ? row.domain : "flight";
}

/** The text of a training sample, as the parsers would see it. */
function sampleText(annotations: unknown): { subject: string; body: string } | null {
  if (typeof annotations !== "object" || annotations === null) return null;
  const ann = annotations as Record<string, unknown>;
  const fullText = typeof ann.fullText === "string" ? ann.fullText : "";
  if (fullText.length === 0) return null;
  const subjectMatch = /^Subject:\s*(.+)$/im.exec(fullText);
  return { subject: subjectMatch ? subjectMatch[1].trim() : "", body: fullText };
}

interface PreviewSide {
  sampleId: string;
  filename: string | null;
  result: TemplatePreview;
}

// POST /api/v1/parser-templates/:id/preview
//
// forgejo#124 phase 6: a template is run before it is trusted. It reads the
// sample it was derived from AND a held-out sample of the same domain, and
// the answer is what the activation gate below consults. A template that
// cannot read its OWN sample cannot read anything, and activating it would
// put a reader in the parse chain that only ever contributes nothing — or,
// worse, a plausible wrong value a human accepts by habit (plan §7).
router.post("/:id/preview", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const template = await prisma.parserTemplate.findUnique({ where: { id: req.params.id } });
    if (!template) throw new AppError("Template not found", 404);
    if (template.userId !== userId) throw new AppError("Unauthorized", 403);

    const domain = domainOf(template);
    const asUserTemplate = toUserTemplate(template);

    const own = template.sourceId
      ? await prisma.trainingData.findFirst({ where: { id: template.sourceId, userId } })
      : null;
    const ownText = own ? sampleText(own.annotations) : null;
    const ownSide: PreviewSide | null =
      own && ownText
        ? {
            sampleId: own.id,
            filename: null,
            result: previewTemplate(domain, asUserTemplate, ownText.subject, ownText.body),
          }
        : null;

    // Held out on purpose: a SECOND document of the same domain that the
    // template was not derived from. Reading its own sample proves only that
    // the patterns were copied out of it correctly; this is the first evidence
    // that the template describes a SENDER rather than one booking.
    const heldOutRow = await prisma.trainingData.findFirst({
      where: { userId, domain, id: { not: own?.id ?? "" } },
      orderBy: { createdAt: "desc" },
    });
    const heldOutText = heldOutRow ? sampleText(heldOutRow.annotations) : null;
    const heldOutSide: PreviewSide | null =
      heldOutRow && heldOutText
        ? {
            sampleId: heldOutRow.id,
            filename: null,
            result: previewTemplate(domain, asUserTemplate, heldOutText.subject, heldOutText.body),
          }
        : null;

    const passed = ownSide?.result.matched === true && ownSide.result.fields.length > 0;

    const record: PreviewRecord = {
      at: new Date().toISOString(),
      previewOf: template.updatedAt.toISOString(),
      passed,
      ownSampleId: ownSide?.sampleId ?? "",
      heldOutSampleId: heldOutSide?.sampleId ?? null,
    };
    const stats = { ...readStats(template.stats), preview: record };
    await prisma.parserTemplate.update({
      where: { id: template.id },
      data: {
        stats: stats as unknown as object,
        // `updatedAt` is `@updatedAt`, so this write would otherwise move the
        // very timestamp the proof names, and the template would be stale the
        // instant it was proven. Holding it is what makes `previewOf` mean
        // "these bytes" rather than "some earlier bytes".
        updatedAt: template.updatedAt,
      },
    });

    logger.info(
      { templateId: template.id, domain, passed, heldOut: heldOutSide?.sampleId ?? null },
      "TemplatePreview: ran"
    );

    res.json({
      templateId: template.id,
      domain,
      own: ownSide,
      heldOut: heldOutSide,
      /** Why there is no held-out side, when there is none. */
      heldOutReason: heldOutSide ? null : "noSecondSample",
      canActivate: passed,
      previewOf: record.previewOf,
    });
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

    // The activation gate. Disabling never needs a proof — turning a reader
    // OFF cannot produce a wrong value — so only the way in is guarded.
    if (status === "active") {
      const preview = readStats(existing.stats).preview;
      const fresh = preview?.previewOf === existing.updatedAt.toISOString();
      if (!preview?.passed || !fresh) {
        throw new AppError(
          preview && !fresh
            ? "This template changed after its last preview. Run the preview again."
            : "Run the preview before activating this template.",
          409,
          "PREVIEW_REQUIRED"
        );
      }
    }

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
