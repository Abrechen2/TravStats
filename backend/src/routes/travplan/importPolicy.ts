import type { NextFunction, Response } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import {
  assertEnabled,
  ownedPlan,
  reserveUsage,
  configuration,
} from "../../services/travplan/store";
import { parseState } from "../../services/travplan/upgrade";
import { assertTravPlanForUser, assertTravPlanOffered } from "../../services/travplan/availability";
import { withLlmRequestPolicy } from "../../services/llm/requestPolicy";
const inputs = new Set(["/parse-email", "/parse-email-file", "/parse-pdf", "/parse-image"]);
/** The existing parser pipeline reads under this trip's explicit request policy. */
export function planningImportPolicy(req: AuthRequest, res: Response, next: NextFunction) {
  const trip = req.get("X-TravPlan-Trip");
  if (!trip || !inputs.has(req.path)) return next();
  void authenticate(req, res, (error) => {
    if (error) return next(error);
    void (async () => {
      await assertTravPlanOffered();
      await assertEnabled();
      await assertTravPlanForUser(req.userId!);
      const plan = await ownedPlan(req.userId!, z.string().uuid().parse(trip));
      const state = parseState(plan.state);
      const policy = req.get("X-TravPlan-AI") === "true" ? state.ai.policy : "disabled";
      if (policy !== "disabled")
        await reserveUsage(req.userId!, "ai", (await configuration()).aiDailyLimit);
      withLlmRequestPolicy(policy, () => next());
    })().catch(next);
  });
}
