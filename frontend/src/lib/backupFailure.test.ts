import { describe, it, expect } from "vitest";
import { cloudDownloadFailureKey } from "./backupFailure";

describe("cloudDownloadFailureKey — 502 WEBDAV_DOWNLOAD_TRUNCATED", () => {
  it("names a cut-short WebDAV download instead of the generic failure", () => {
    const err = { response: { status: 502, data: { code: "WEBDAV_DOWNLOAD_TRUNCATED" } } };
    expect(cloudDownloadFailureKey(err, "fallback")).toBe("admin:backup.toasts.downloadTruncated");
  });
  it("falls back for any other error", () => {
    expect(cloudDownloadFailureKey(new Error("x"), "fallback")).toBe("fallback");
  });
});
