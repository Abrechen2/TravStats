import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError } from "axios";

const post = vi.hoisted(() => vi.fn());
const waitForJob = vi.hoisted(() => vi.fn());
vi.mock("../client", () => ({ default: { post } }));
vi.mock("../jobs", async (orig) => ({
  ...(await orig<typeof import("../jobs")>()),
  waitForJob,
}));

import { sendCheckinImport } from "../checkinImport";
import { JobFailedError, JobLostError } from "../jobs";

const axiosFail = (status: number | undefined, code?: string) => {
  const err = new AxiosError("x");
  if (status) {
    err.response = { status, data: { code } } as AxiosError["response"];
  }
  return err;
};
const kindOf = async (dryRun: boolean) =>
  sendCheckinImport("travelling", "x", dryRun).catch((e: { kind: string }) => e.kind);

beforeEach(() => {
  post.mockReset();
  waitForJob.mockReset();
  post.mockResolvedValue({ data: { data: { jobId: "j1" } } });
});

describe("sendCheckinImport — every failure gets its own kind", () => {
  it("posts as a background job and returns the job's outcome", async () => {
    waitForJob.mockResolvedValueOnce({ clean: true });
    await expect(sendCheckinImport("travelynx", "{}", true)).resolves.toEqual({ clean: true });
    expect(post).toHaveBeenCalledWith("/checkin-import", {
      source: "travelynx",
      content: "{}",
      dryRun: true,
      background: true,
    });
  });

  it("maps the too-many-rows refusal, from the request or from the job", async () => {
    post.mockRejectedValueOnce(axiosFail(400, "IMPORT_TOO_MANY_ROWS"));
    expect(await kindOf(true)).toBe("tooMany");
    waitForJob.mockRejectedValueOnce(new JobFailedError("IMPORT_TOO_MANY_ROWS", 400));
    expect(await kindOf(true)).toBe("tooMany");
  });

  it("maps no response to network, 429 to rateLimited, another 400 to invalid", async () => {
    post.mockRejectedValueOnce(axiosFail(undefined));
    expect(await kindOf(true)).toBe("network");
    // After an apply the request may have arrived: unknown, not "nothing changed".
    post.mockRejectedValueOnce(axiosFail(undefined));
    expect(await kindOf(false)).toBe("outcomeUnknown");
    post.mockRejectedValueOnce(axiosFail(429));
    expect(await kindOf(true)).toBe("rateLimited");
    post.mockRejectedValueOnce(axiosFail(400, "VALIDATION_ERROR"));
    expect(await kindOf(true)).toBe("invalid");
  });

  it("a lost job is network after a preview but unknown after an apply", async () => {
    waitForJob.mockRejectedValue(new JobLostError());
    expect(await kindOf(true)).toBe("network");
    expect(await kindOf(false)).toBe("outcomeUnknown");
  });
});
