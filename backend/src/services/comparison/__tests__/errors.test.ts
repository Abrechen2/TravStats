import logger from "../../../utils/logger";
import { AppError } from "../../../middleware/errorHandler";
import { comparisonError } from "../errors";
import { PeerRefusal, refused } from "../../federation/refusal";

describe("comparison error vocabulary", () => {
  it("names the cause in a code and logs it before the error is thrown", () => {
    const info = jest.spyOn(logger, "info").mockImplementation(() => undefined as never);
    const error = comparisonError("COMPARISON_SELF", 400, "Cannot compare with yourself", {
      userId: "u1",
    });
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 400, code: "COMPARISON_SELF" });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "comparison_refused",
        code: "COMPARISON_SELF",
        userId: "u1",
      }),
      "Cannot compare with yourself"
    );
    info.mockRestore();
  });

  it("keeps the peer's answer generic while the kind says why", () => {
    const error = refused("replay");
    expect(error).toBeInstanceOf(PeerRefusal);
    expect(error).toMatchObject({
      statusCode: 403,
      kind: "replay",
      message: "Peer request refused",
    });
    expect(refused().kind).toBe("refused");
  });
});
