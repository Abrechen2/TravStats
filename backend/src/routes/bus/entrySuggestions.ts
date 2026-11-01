import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { statsLimiter } from "../../middleware/rateLimit";
import { rankedColumn } from "../../services/entrySuggestions/ranked";
import { terminalsFor, type TerminalSuggestion } from "../../services/entrySuggestions/terminals";

/**
 * `GET /bus/entry-suggestions` — what the bus form can offer from the user's
 * own logbook: the operators they ride with, the fare classes they have used
 * with the one typed, and the terminals that start with what they typed. There
 * is no worldwide catalogue of coach terminals (spec §3.2), so the second ride
 * out of Seoul is the first time the form knows Seoul's position, country and
 * address — without this, every terminal is typed twice.
 *
 * Offered, never written: the form shows chips and a chip fills a field only
 * when clicked, so everything returned is a value some earlier row stored. A
 * fare class is the operator's own vocabulary ("Udeung"), which is why it is
 * suggested per operator and not from a fixed list.
 *
 * Enveloped, like the rest of the bus family. Mounted ahead of the bus router,
 * whose `/:id` would otherwise read "entry-suggestions" as an id. Rate-limited
 * with the stats bucket: three aggregations over the logbook, asked for when a
 * terminal or the operator settles, not per keystroke.
 */
const router = Router();
router.use(authenticate);

const OPERATOR_CAP = 5;
const FARE_CLASS_CAP = 4;

const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const typed = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const busEntrySuggestionsQuerySchema = z.object({
  /** What has been typed into the departure / arrival terminal field. */
  depName: typed(200),
  arrName: typed(200),
  /** The operator field, which narrows the fare classes offered. */
  operator: typed(100),
});

export type BusEntrySuggestionsQuery = z.infer<typeof busEntrySuggestionsQuerySchema>;

export type BusTerminalSuggestion = TerminalSuggestion;

export interface BusEntrySuggestions {
  operators: string[];
  fareClasses: string[];
  terminals: BusTerminalSuggestion[];
}

const ranked = (field: "operator" | "fareClass", where: object, cap: number): Promise<string[]> =>
  rankedColumn(prisma.busJourney, field, where, cap);

/** The class is the operator's vocabulary, so it is offered for the operator typed. */
function fareClassesFor(userId: string, operator: string | undefined): Promise<string[]> {
  const where: object = operator
    ? { userId, operator: { equals: operator, mode: "insensitive" } }
    : { userId };
  return ranked("fareClass", where, FARE_CLASS_CAP);
}

export async function loadBusEntrySuggestions(
  userId: string,
  query: BusEntrySuggestionsQuery
): Promise<BusEntrySuggestions> {
  const [operators, fareClasses, terminals] = await Promise.all([
    ranked("operator", { userId }, OPERATOR_CAP),
    fareClassesFor(userId, query.operator),
    terminalsFor(prisma.busJourney, userId, query),
  ]);
  return { operators, fareClasses, terminals };
}

router.get(
  "/",
  statsLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = busEntrySuggestionsQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError(parsed.error.message, 400);
      const data = await loadBusEntrySuggestions(req.userId!, parsed.data);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
