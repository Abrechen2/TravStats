import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../client";
import { setRemotePlanSource } from "../remotePlans";
import { travplanApi, type PlanView } from "../travplan";

const plan = { tripId: "t1", revision: 4, packingRev: 7 } as unknown as PlanView;

afterEach(() => {
  setRemotePlanSource(null);
  vi.restoreAllMocks();
});

const bodyOf = (post: ReturnType<typeof vi.spyOn>) =>
  (post.mock.calls[0] as unknown[])[1] as Record<string, unknown>;

describe("plan writes on the single packing store (forgejo#398)", () => {
  it("names the packing rev the view was drawn at, so a list the Companion changed is refused", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: plan });
    await travplanApi.write(plan, {
      type: "upsert",
      collection: "packing",
      value: { id: "a" },
    });
    expect(bodyOf(post).basePackingRev).toBe(7);
    expect(bodyOf(post).baseRevision).toBe(4);
  });

  it("names it for a removal as well", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: plan });
    await travplanApi.write(plan, { type: "remove", collection: "packing", id: "a" });
    expect(bodyOf(post).basePackingRev).toBe(7);
  });

  it("leaves it out for any other collection", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: plan });
    await travplanApi.write(plan, { type: "remove", collection: "tasks", id: "a" });
    expect("basePackingRev" in bodyOf(post)).toBe(false);
  });
});
