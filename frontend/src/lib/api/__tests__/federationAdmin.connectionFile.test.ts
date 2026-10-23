import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError } from "axios";
import { federationAdminApi, federationErrorCode } from "../federationAdmin";
import { api } from "../client";

vi.mock("../client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe("federationAdminApi connection file", () => {
  beforeEach(() => vi.clearAllMocks());

  it("downloads as a blob under the name the server gives it", async () => {
    const blob = new Blob(["zip"]);
    vi.mocked(api.get).mockResolvedValue({
      data: blob,
      headers: { "content-disposition": 'attachment; filename="travstats-verbindung-a.b.zip"' },
    });
    await expect(federationAdminApi.downloadConnectionFile()).resolves.toEqual({
      blob,
      filename: "travstats-verbindung-a.b.zip",
    });
    expect(api.get).toHaveBeenCalledWith("/admin/federation/connection-file", {
      responseType: "blob",
    });
  });

  it("reads the refusal code out of a blob error body", async () => {
    const error = new AxiosError("refused");
    error.response = {
      status: 409,
      data: new Blob([JSON.stringify({ error: "x", code: "COMPARISON_FEDERATION_OFF" })]),
      statusText: "",
      headers: {},
      config: { headers: {} } as never,
    };
    vi.mocked(api.get).mockRejectedValue(error);
    const caught = await federationAdminApi.downloadConnectionFile().catch((e: unknown) => e);
    expect(federationErrorCode(caught)).toBe("COMPARISON_FEDERATION_OFF");
  });

  it("uploads the file as multipart", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { origin: "https://a.b" } });
    const file = new File(["{}"], "c.json");
    await federationAdminApi.inspectConnectionFile(file);
    const [url, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe("/admin/federation/connection-file/inspect");
    expect((body as FormData).get("file")).toBeInstanceOf(File);
    expect(config).toEqual({ headers: { "Content-Type": "multipart/form-data" } });
  });
});
