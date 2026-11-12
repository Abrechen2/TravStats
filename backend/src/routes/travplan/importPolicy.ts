import type { NextFunction, Response } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../../middleware/auth";
import { assertEnabled, reserveUsage, configuration } from "../../services/travplan/store";
import { accessiblePlan } from "../../services/travplan/access";
import { parseState } from "../../services/travplan/upgrade";
import {
  assertTravPlanForUser,
  assertTravPlanOffered,
  travPlanAiUserEnabled,
} from "../../services/travplan/availability";
import { withLlmRequestPolicy } from "../../services/llm/requestPolicy";
const inputs = new Set([
  "/parse-email",
  "/parse-email-file",
  "/parse-pdf",
  "/parse-image",
  // A ferry ticket read from text (forgejo#404): its labelled reader and model obey the plan too.
  "/ferry/ticket-preview",
]);
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
      const plan = await accessiblePlan(req.userId!, z.string().uuid().parse(trip));
      const state = parseState(plan.state);
      // The account's "AI in plans" switch (settings v3) is the same as not asking for AI.
      const aiAsked =
        req.get("X-TravPlan-AI") === "true" && (await travPlanAiUserEnabled(req.userId!));
      const policy = aiAsked ? state.ai.policy : "disabled";
      if (policy !== "disabled")
        await reserveUsage(req.userId!, "ai", (await configuration()).aiDailyLimit);
      withLlmRequestPolicy(policy, () => next());
    })().catch(next);
  });
}
