import type { Request, Response } from "express";

import { changeContextMiddleware, resolveChangeContext, withChangeSource } from "../context";

/**
 * A write made through travstats-mcp is named as such in the change history: the package sends
 * `X-TravStats-Client: travstats-mcp/<version>` and the token's label says WHICH assistant wrote.
 * Only a token-authenticated request counts, so a cookie session cannot dress itself as MCP.
 */
function resolveFor(req: Record<string, unknown>) {
  let out: ReturnType<typeof resolveChangeContext> = null;
  changeContextMiddleware(req as unknown as Request, {} as Response, () => {
    out = resolveChangeContext();
  });
  return out as ReturnType<typeof resolveChangeContext>;
}

describe("change history: writes via MCP", () => {
  const mcpHeader = { "x-travstats-client": "travstats-mcp/0.2.0" };

  it("names the token behind an MCP write ('via MCP / <label>')", () => {
    const ctx = resolveFor({
      userId: "u1",
      apiToken: { label: "Claude Desktop" },
      headers: mcpHeader,
    });
    expect(ctx).toMatchObject({ source: "api", reason: "via MCP / Claude Desktop" });
  });

  it("leaves an ordinary token write without a reason", () => {
    const ctx = resolveFor({ userId: "u1", apiToken: { label: "script" }, headers: {} });
    expect(ctx?.reason).toBeNull();
  });

  it("does not let a cookie session claim to be MCP", () => {
    expect(resolveFor({ userId: "u1", headers: mcpHeader })?.reason).toBeNull();
  });

  it("does not relabel a Companion device token", () => {
    const ctx = resolveFor({
      userId: "u1",
      apiToken: { deviceId: "d1", label: "iPad" },
      headers: mcpHeader,
    });
    expect(ctx).toMatchObject({ source: "companion", reason: null });
  });

  it("keeps a reason a code path set itself", async () => {
    let reason: string | null | undefined;
    await new Promise<void>((resolve) =>
      changeContextMiddleware(
        { userId: "u1", apiToken: { label: "x" }, headers: mcpHeader } as unknown as Request,
        {} as Response,
        () => {
          void withChangeSource(
            "merge",
            async () => {
              reason = resolveChangeContext()?.reason;
            },
            { reason: "duplicate merge" }
          ).then(resolve);
        }
      )
    );
    expect(reason).toBe("duplicate merge");
  });
});
