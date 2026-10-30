import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import deTravplan from "../resources/de/travplan.json";
import enTravplan from "../resources/en/travplan.json";

/**
 * `usePlan` turns a backend error code into `travplan:errors.<code>` and falls
 * back to the generic "did not work, try again". Five codes the planner throws
 * had no copy, so "the plan is over 1 MB" or "that entry is gone" told the user
 * to retry an action that can never succeed. The vocabulary is the `PLAN_*`
 * members of the backend's error-code union.
 */
const ERROR_HANDLER = path.resolve(__dirname, "../../../../backend/src/middleware/apiErrorCode.ts");
const codes = [
  ...new Set(fs.readFileSync(ERROR_HANDLER, "utf8").match(/"PLAN_[A-Z_]+"/g) ?? []),
].map((c) => c.slice(1, -1));

describe("every planner error code has its own copy", () => {
  it("reads the vocabulary", () => {
    expect(codes.length).toBeGreaterThan(20);
  });
  it.each(codes)("%s", (code) => {
    expect((deTravplan.errors as Record<string, string>)[code]).toBeTruthy();
    expect((enTravplan.errors as Record<string, string>)[code]).toBeTruthy();
  });
});
