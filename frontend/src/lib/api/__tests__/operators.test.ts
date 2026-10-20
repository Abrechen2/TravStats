import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.hoisted(() => vi.fn());
vi.mock("../client", () => ({ api: { get: getMock } }));

import { __clearOperatorMarkCache, getOperatorMark } from "../operators";

/** forgejo#323 review: a "pending" mark must be asked again, a settled one not. */
describe("getOperatorMark", () => {
  beforeEach(() => {
    getMock.mockReset();
    __clearOperatorMarkCache();
  });

  it("asks once per operator for a settled answer", async () => {
    getMock.mockResolvedValue({
      data: { success: true, data: { available: false, pending: false } },
    });
    await getOperatorMark("ferry", "Stena Line");
    await getOperatorMark("ferry", "stena line");
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after a pending answer", async () => {
    getMock.mockResolvedValue({
      data: { success: true, data: { available: false, pending: true } },
    });
    await getOperatorMark("ferry", "Stena Line");
    await getOperatorMark("ferry", "Stena Line");
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
