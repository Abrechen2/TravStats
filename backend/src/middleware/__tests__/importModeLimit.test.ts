import { describe, expect, it, jest } from "@jest/globals";
import type { Request } from "express";

jest.mock("../../services/importMode", () => ({ importModeCovers: jest.fn() }));
import { importModeCovers } from "../../services/importMode";
import { importModeSkips } from "../importModeLimit";

const covers = jest.mocked(importModeCovers);
const req = (extra: object) => extra as unknown as Request;

/** Who import mode (forgejo#304) may let past a limiter, and who never. */
describe("importModeSkips", () => {
  it("lets a covered account through", async () => {
    covers.mockResolvedValueOnce(true);
    expect(await importModeSkips(req({ userId: "u1" }))).toBe(true);
  });

  it("never lifts the shared demo, whatever the setting says", async () => {
    covers.mockResolvedValue(true);
    expect(await importModeSkips(req({ userId: "demo", isSharedDemo: true }))).toBe(false);
  });

  it("keeps the limit for a request with no account (mounted before authenticate)", async () => {
    covers.mockResolvedValue(true);
    expect(await importModeSkips(req({}))).toBe(false);
  });

  it("keeps the limit when the setting cannot be read", async () => {
    covers.mockRejectedValueOnce(new Error("database down"));
    expect(await importModeSkips(req({ userId: "u1" }))).toBe(false);
  });
});
