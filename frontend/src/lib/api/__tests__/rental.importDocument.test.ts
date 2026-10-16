import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("../client", () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

import { rentalApi } from "../rental";
import type { RentalBooking } from "../../../types/rental";

const rental = { id: "r-1" } as RentalBooking;

beforeEach(() => vi.clearAllMocks());

describe("rentalApi.importDocument", () => {
  it("passes on the deadlines a later mail filled on a stored booking (forgejo#285)", async () => {
    post.mockResolvedValue({
      data: {
        success: true,
        data: rental,
        meta: { outcome: "updated", filledDeadlines: ["freeCancellationUntil", "paymentDueOn"] },
      },
    });
    const res = await rentalApi.importDocument({
      kind: "cancellation",
      provider: "Testcar",
      confirmationNumber: "1",
    });
    expect(res).toEqual({
      rental,
      outcome: "updated",
      filledDeadlines: ["freeCancellationUntil", "paymentDueOn"],
    });
  });

  it("answers an empty list when the server filled nothing and sent no field", async () => {
    post.mockResolvedValue({ data: { success: true, data: rental, meta: { outcome: "created" } } });
    const res = await rentalApi.importDocument({
      kind: "cancellation",
      provider: "Testcar",
      confirmationNumber: "1",
    });
    expect(res.filledDeadlines).toEqual([]);
  });
});
