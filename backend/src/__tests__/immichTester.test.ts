import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const getServerVersion = jest.fn<() => Promise<string>>();
const whoami = jest.fn<() => Promise<{ id: string; email: string; name: string }>>();

jest.mock("../services/immich/immichClient", () => ({
  createImmichClient: () => ({ getServerVersion, whoami }),
}));

import { testImmichConnection } from "../services/immich/immichTester";
import { ImmichError } from "../services/immich/types";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("testImmichConnection", () => {
  it("reports the server version and the authenticated user on success", async () => {
    getServerVersion.mockResolvedValue("1.138.2");
    whoami.mockResolvedValue({ id: "u1", email: "a@b.c", name: "Ann" });

    await expect(testImmichConnection("https://immich.lan", "key")).resolves.toEqual({
      success: true,
      message: "Connected to Immich",
      details: { version: "1.138.2", user: "Ann" },
    });
  });

  it("distinguishes a bad key from an unreachable server, carrying the kind", async () => {
    getServerVersion.mockResolvedValue("1.138.2");
    whoami.mockRejectedValue(new ImmichError("auth", "Immich rejected the API key", 401));
    await expect(testImmichConnection("https://immich.lan", "bad")).resolves.toMatchObject({
      success: false,
      kind: "auth",
      message: "Immich rejected the API key",
    });

    getServerVersion.mockRejectedValue(new ImmichError("unreachable", "Immich is unreachable"));
    await expect(testImmichConnection("https://immich.lan", "key")).resolves.toMatchObject({
      success: false,
      kind: "unreachable",
      message: "Immich is unreachable",
    });
  });

  it("reports a non-http base URL as an invalidUrl kind without calling Immich", async () => {
    await expect(testImmichConnection("file:///etc/passwd", "key")).resolves.toMatchObject({
      success: false,
      kind: "invalidUrl",
      message: "Immich URL must use http:// or https://",
    });
    expect(getServerVersion).not.toHaveBeenCalled();
  });

  it("reports a malformed base URL as an invalidUrl kind without calling Immich", async () => {
    await expect(testImmichConnection("not-a-url", "key")).resolves.toMatchObject({
      success: false,
      kind: "invalidUrl",
      message: "Immich URL is not a valid URL",
    });
    expect(getServerVersion).not.toHaveBeenCalled();
  });

  it("reports a protocol mismatch when the server answers with garbage", async () => {
    getServerVersion.mockRejectedValue(
      new ImmichError("protocol", "Immich returned an unexpected version payload"),
    );
    await expect(testImmichConnection("https://immich.lan", "key")).resolves.toEqual({
      success: false,
      kind: "protocol",
      message: "Immich returned an unexpected version payload",
    });
  });
});
