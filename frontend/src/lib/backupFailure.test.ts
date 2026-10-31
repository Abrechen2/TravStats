import { describe, it, expect } from "vitest";
import { JobFailedError } from "./api/jobs";
import { cloudBackupFailureKey } from "./backupFailure";

describe("cloudBackupFailureKey — 502 WEBDAV_DOWNLOAD_TRUNCATED", () => {
  it("names a cut-short WebDAV download instead of the generic failure", () => {
    const err = { response: { status: 502, data: { code: "WEBDAV_DOWNLOAD_TRUNCATED" } } };
    expect(cloudBackupFailureKey(err, "fallback")).toBe("admin:backup.toasts.downloadTruncated");
  });
  it("falls back for any other error", () => {
    expect(cloudBackupFailureKey(new Error("x"), "fallback")).toBe("fallback");
  });
});

describe("cloudBackupFailureKey — a job's error code", () => {
  it("words each WebDAV cause with its own sentence", () => {
    expect(cloudBackupFailureKey(new JobFailedError("WEBDAV_BACKUP_QUOTA", 502), "fb")).toBe(
      "admin:backup.cloudFailure.WEBDAV_BACKUP_QUOTA"
    );
    expect(
      cloudBackupFailureKey(new JobFailedError("WEBDAV_DOWNLOAD_CHECKSUM_MISMATCH", 502), "fb")
    ).toBe("admin:backup.cloudFailure.WEBDAV_DOWNLOAD_CHECKSUM_MISMATCH");
    expect(cloudBackupFailureKey(new JobFailedError("WEBDAV_DOWNLOAD_TRUNCATED", 502), "fb")).toBe(
      "admin:backup.toasts.downloadTruncated"
    );
  });
  it("falls back for a code it does not know", () => {
    expect(cloudBackupFailureKey(new JobFailedError("JOB_FAILED", 500), "fb")).toBe("fb");
  });
});
