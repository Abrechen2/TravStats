/**
 * Package tours → trips (plan 2026-10-09 P3).
 *
 *   POST /trips/package/preview  the reading → a trip proposal; writes nothing
 *   POST /trips/package/commit   the same proposal, written in one transaction
 *
 * Both take the package reading a parse answered (`package` of a
 * `domain: "package"` parse body) OR the id of a document whose stored parse
 * holds one, plus the reviewer's choices. With a `documentId`, the commit
 * files that document on the trip. The proposal is rebuilt on commit, never
 * taken from the client.
 *
 * Enveloped family (ADR 0001), like the other import routers. Mounted before
 * `trips`, so `/trips/package/...` is never read as a trip id.
 */
import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../../db";
import { authenticate, requireWriteScope, AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { batchCreationLimiter } from "../../middleware/rateLimit";
import { validatePackageValues, type PackageContract } from "../../services/trip/package/contract";
import { buildPackageProposal } from "../../services/trip/package/proposal";
import { commitPackageProposal } from "../../services/trip/package/commit";
import { packageChoicesSchema } from "../../services/trip/package/types";

const router = Router();

/**
 * The contract names 18 fields; the margin admits a template's extra names,
 * which the contract strips. Every list and string inside is bounded by the
 * contract itself (`contract.ts`), and the whole body by the JSON limit.
 */
const MAX_READING_KEYS = 40;

export const packageRequestSchema = z
  .object({
    /** The `package` field of a package parse body. Validated against the contract below. */
    reading: z
      .record(z.string().max(40), z.unknown())
      .refine((r) => Object.keys(r).length <= MAX_READING_KEYS, {
        message: `at most ${MAX_READING_KEYS} fields`,
      })
      .optional(),
    documentId: z.string().uuid().optional(),
    choices: packageChoicesSchema.optional(),
  })
  .strict()
  .refine((b) => b.reading !== undefined || b.documentId !== undefined, {
    message: "Send reading or documentId",
  });
type PackageRequest = z.infer<typeof packageRequestSchema>;

function contractOf(values: unknown): PackageContract {
  const checked = validatePackageValues(values);
  if (checked.ok) return checked.contract;
  throw new AppError("The package reading is invalid", 422, "PACKAGE_READING_INVALID", "reading", {
    issues: checked.issues.slice(0, 10).join("; "),
  });
}

/** The reading sent, or the one stored on the caller's document. */
async function readingOf(userId: string, body: PackageRequest): Promise<PackageContract> {
  if (body.reading) return contractOf(body.reading);
  const document = await prisma.document.findFirst({
    where: { id: body.documentId!, userId },
    select: { parsedDomain: true, parsedPayload: true },
  });
  if (!document) throw new AppError("Document not found", 404);
  const payload = document.parsedPayload as { package?: unknown } | null;
  if (document.parsedDomain !== "package" || !payload?.package) {
    throw new AppError(
      "The document holds no package reading — parse it as a package first",
      422,
      "PACKAGE_READING_MISSING",
      "documentId"
    );
  }
  return contractOf(payload.package);
}

router.post(
  "/trips/package/preview",
  authenticate,
  requireWriteScope,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = packageRequestSchema.parse(req.body);
      const reading = await readingOf(userId, body);
      const proposal = await buildPackageProposal(userId, reading, {
        ...(body.documentId ? { documentId: body.documentId } : {}),
        ...(body.choices ? { choices: body.choices } : {}),
      });
      res.json({ success: true, data: { proposal } });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/trips/package/commit",
  authenticate,
  requireWriteScope,
  batchCreationLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId!;
      const body = packageRequestSchema.parse(req.body);
      const reading = await readingOf(userId, body);
      const result = await commitPackageProposal(userId, reading, {
        ...(body.documentId ? { documentId: body.documentId } : {}),
        ...(body.choices ? { choices: body.choices } : {}),
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
